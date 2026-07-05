<?php
// SC Landing Pages shim. Drop this file (plus the included .htaccess) into the document
// root of any host — custom domain, raw IP, or a subdirectory — and it'll serve the
// landing page this deployment was issued for. Every request is forwarded to the central
// server, which runs the antibot pipeline and returns the response.
// The embedded secret is unique to one landing page. Don't share this file. Rotate it
// from the dashboard if you suspect it leaked.

declare(strict_types=1);

const CENTRAL_URL    = '{{CENTRAL_URL}}';
const SHIM_PAGE_ID   = '{{SHIM_PAGE_ID}}';
const SHIM_SECRET    = '{{SHIM_SECRET}}';

@set_time_limit(0);
@ignore_user_abort(false);

// 1. Determine the visitor's real IP (prefer Cloudflare / Real-IP headers if present).
function shim_visitor_ip(): string {
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP'] as $h) {
        if (!empty($_SERVER[$h])) return trim($_SERVER[$h]);
    }
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0];
        return trim($first);
    }
    return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
}

// 2. Build target URL on central (preserve original path + query string).
$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$target = rtrim(CENTRAL_URL, '/') . '/_shim/proxy' . $requestUri;

// 3. Collect inbound headers, drop hop-by-hop ones and anything cURL will set itself.
$hopByHop = ['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding', 'expect'];
$outboundHeaders = [];
foreach ($_SERVER as $k => $v) {
    if (strpos($k, 'HTTP_') !== 0) continue;
    $name = strtolower(str_replace('_', '-', substr($k, 5)));
    if (in_array($name, $hopByHop, true)) continue;
    $outboundHeaders[] = ucwords($name, '-') . ': ' . $v;
}
// Apache/PHP place Content-Type and Content-Length under $_SERVER without the HTTP_ prefix
// (e.g. $_SERVER['CONTENT_TYPE']). Forward Content-Type so the central server's JSON parser
// can see the body. Content-Length stays out — cURL recalculates it from CURLOPT_POSTFIELDS.
if (!empty($_SERVER['CONTENT_TYPE'])) {
    $outboundHeaders[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}
$outboundHeaders[] = 'X-Shim-Key: '     . SHIM_SECRET;
$outboundHeaders[] = 'X-Shim-Real-IP: ' . shim_visitor_ip();
$outboundHeaders[] = 'X-Shim-Page: '    . SHIM_PAGE_ID;

// 4. Capture POST body if present.
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = null;
if (!in_array($method, ['GET', 'HEAD'], true)) {
    $body = file_get_contents('php://input');
}

// 5. Set up cURL with streaming callbacks.
$headersSent = false;
$responseStatus = 200;

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $target,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $outboundHeaders,
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT        => 0,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);
if ($body !== null && $body !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

// Header callback: strip the Domain= attribute from any Set-Cookie so the cookie binds
// to the visitor's host, and forward every header through to the client.
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($curl, $headerLine) use (&$headersSent, &$responseStatus) {
    $len = strlen($headerLine);
    $trim = rtrim($headerLine);
    if ($trim === '') return $len; // end of headers — body follows

    // Status line: "HTTP/1.1 200 OK"
    if (stripos($trim, 'HTTP/') === 0) {
        $parts = explode(' ', $trim, 3);
        if (isset($parts[1])) $responseStatus = (int)$parts[1];
        http_response_code($responseStatus);
        $headersSent = true;
        return $len;
    }

    $colonPos = strpos($trim, ':');
    if ($colonPos === false) return $len;
    $name = strtolower(trim(substr($trim, 0, $colonPos)));
    $value = trim(substr($trim, $colonPos + 1));

    // Drop hop-by-hop / transport-level headers; let PHP/Apache manage them.
    if (in_array($name, ['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'content-encoding'], true)) {
        return $len;
    }

    if ($name === 'set-cookie') {
        // Strip Domain= attribute so the cookie is first-party on the visitor's host.
        $value = preg_replace('/;\s*Domain=[^;]+/i', '', $value);
        header('Set-Cookie: ' . $value, false);
        return $len;
    }

    header(ucwords($name, '-') . ': ' . $value, true);
    return $len;
});

// Body callback: stream chunks straight to the visitor.
curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($curl, $chunk) {
    echo $chunk;
    @ob_flush();
    @flush();
    return strlen($chunk);
});

if (!curl_exec($ch)) {
    if (!$headersSent) {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Upstream error: ' . curl_error($ch);
    }
}
curl_close($ch);
