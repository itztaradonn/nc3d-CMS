<?php
// NC3D admin core helpers. PHP 7.4+ compatible. No database, no cron, no CLI.
declare(strict_types=1);

define('NC3D_ROOT', dirname(__DIR__));
define('NC3D_DATA', NC3D_ROOT . '/data/content.json');
define('NC3D_PRIVATE', NC3D_ROOT . '/private');
define('NC3D_AUTH', NC3D_PRIVATE . '/auth.php');
define('NC3D_RATE', NC3D_PRIVATE . '/ratelimit.php');
define('NC3D_MAX_MODEL_MB', 100);
define('NC3D_MAX_IMAGE_MB', 8);

function nc3d_session(): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('nc3d_admin');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function is_setup(): bool {
    return is_file(NC3D_AUTH);
}

function auth_data(): array {
    if (!is_setup()) return [];
    $d = include NC3D_AUTH;
    return is_array($d) ? $d : [];
}

function write_auth(string $password): bool {
    $hash = password_hash($password, PASSWORD_DEFAULT);
    $php = "<?php\n// NC3D admin login. Delete this file to run setup again.\nreturn " . var_export(['hash' => $hash, 'updated' => date('c')], true) . ";\n";
    return atomic_write(NC3D_AUTH, $php);
}

function is_logged_in(): bool {
    nc3d_session();
    return !empty($_SESSION['nc3d_ok']);
}

function csrf_token(): string {
    nc3d_session();
    if (empty($_SESSION['nc3d_csrf'])) $_SESSION['nc3d_csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['nc3d_csrf'];
}

function check_csrf(): bool {
    nc3d_session();
    $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    return is_string($sent) && !empty($_SESSION['nc3d_csrf']) && hash_equals($_SESSION['nc3d_csrf'], $sent);
}

function h($s): string {
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function atomic_write(string $path, string $data): bool {
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true)) return false;
    $tmp = $dir . '/.tmp-' . bin2hex(random_bytes(6));
    if (@file_put_contents($tmp, $data, LOCK_EX) === false) return false;
    if (!@rename($tmp, $path)) {
        // some Windows/odd hosts can't rename over an existing file
        @unlink($path);
        if (!@rename($tmp, $path)) { @unlink($tmp); return false; }
    }
    @chmod($path, 0644);
    return true;
}

function read_content(): array {
    $raw = @file_get_contents(NC3D_DATA);
    $c = $raw ? json_decode($raw, true) : null;
    if (!is_array($c)) $c = [];
    $c += ['site' => [], 'colors' => [], 'models' => []];
    return $c;
}

function write_content(array $c): bool {
    $json = json_encode($c, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) return false;
    $lock = @fopen(NC3D_PRIVATE . '/content.lock', 'c');
    if ($lock) flock($lock, LOCK_EX);
    // keep one backup of the previous version
    if (is_file(NC3D_DATA)) @copy(NC3D_DATA, NC3D_PRIVATE . '/content.backup.json');
    $ok = atomic_write(NC3D_DATA, $json);
    if ($lock) { flock($lock, LOCK_UN); fclose($lock); }
    return $ok;
}

function json_out($data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function client_ip(): string {
    return (string)($_SERVER['REMOTE_ADDR'] ?? '0');
}

function rate_load(): array {
    $raw = @file_get_contents(NC3D_RATE);
    if (!$raw) return [];
    $raw = preg_replace('/^<\?php exit; \?>\n/', '', $raw);
    $d = json_decode((string)$raw, true);
    return is_array($d) ? $d : [];
}

function rate_save(array $d): void {
    $now = time();
    foreach ($d as $ip => $v) if (($v['t'] ?? 0) < $now - 3600) unset($d[$ip]);
    atomic_write(NC3D_RATE, "<?php exit; ?>\n" . json_encode($d));
}

function login_blocked(): int {
    $d = rate_load();
    $v = $d[client_ip()] ?? null;
    if (!$v) return 0;
    if (($v['n'] ?? 0) >= 8 && ($v['t'] ?? 0) > time() - 900) return 900 - (time() - $v['t']);
    return 0;
}

function login_fail(): void {
    $d = rate_load();
    $ip = client_ip();
    $v = $d[$ip] ?? ['n' => 0, 't' => time()];
    if (($v['t'] ?? 0) < time() - 900) $v = ['n' => 0, 't' => time()];
    $v['n']++;
    $v['t'] = time();
    $d[$ip] = $v;
    rate_save($d);
}

function login_ok(): void {
    $d = rate_load();
    unset($d[client_ip()]);
    rate_save($d);
    nc3d_session();
    session_regenerate_id(true);
    $_SESSION['nc3d_ok'] = 1;
    $_SESSION['nc3d_csrf'] = bin2hex(random_bytes(32));
}

function ini_bytes(string $v): int {
    $v = trim($v);
    if ($v === '') return 0;
    $n = (float)$v;
    switch (strtolower(substr($v, -1))) {
        case 'g': $n *= 1024;
        // no break
        case 'm': $n *= 1024;
        // no break
        case 'k': $n *= 1024;
    }
    return (int)$n;
}

function upload_limit_bytes(): int {
    $a = ini_bytes((string)ini_get('upload_max_filesize'));
    $b = ini_bytes((string)ini_get('post_max_size'));
    $vals = array_filter([$a, $b]);
    return $vals ? min($vals) : 0;
}

function writable_report(): array {
    $paths = [
        'data/' => NC3D_ROOT . '/data',
        'data/content.json' => NC3D_DATA,
        'uploads/models/' => NC3D_ROOT . '/uploads/models',
        'uploads/images/' => NC3D_ROOT . '/uploads/images',
        'private/' => NC3D_PRIVATE,
    ];
    $out = [];
    foreach ($paths as $label => $p) $out[$label] = file_exists($p) ? is_writable($p) : is_writable(dirname($p));
    return $out;
}
