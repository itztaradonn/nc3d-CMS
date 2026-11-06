<?php
// Fallback file streamer for 3MF models.
// Used only when the host refuses to serve uploads/models/*.3mf directly.
declare(strict_types=1);

$f = (string)($_GET['f'] ?? '');
if (!preg_match('#^uploads/models/[A-Za-z0-9._-]+\.3mf$#i', $f)) {
    http_response_code(400);
    exit('Bad file');
}
$path = __DIR__ . '/' . $f;
if (!is_file($path)) {
    http_response_code(404);
    exit('Not found');
}
header('Content-Type: model/3mf');
header('Content-Length: ' . filesize($path));
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
readfile($path);
