<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
nc3d_session();

if (!is_setup() || !is_logged_in()) json_out(['ok' => false, 'error' => 'Not logged in'], 401);

$action = (string)($_GET['action'] ?? $_POST['action'] ?? '');

// read-only download of a backup (GET is fine, needs session)
if ($action === 'backup') {
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="nc3d-backup-' . date('Ymd-His') . '.json"');
    readfile(NC3D_DATA);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') json_out(['ok' => false, 'error' => 'POST only'], 405);
if (!check_csrf()) json_out(['ok' => false, 'error' => 'Bad CSRF token, reload page'], 403);

// ---------- sanitizers ----------
function s_str($v, int $max = 2000): string {
    if (!is_string($v) && !is_numeric($v)) return '';
    $v = trim((string)$v);
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', $v) ?? '';
    return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
}
function s_i18n($v, int $max = 2000): array {
    if (is_string($v)) return ['th' => s_str($v, $max), 'en' => s_str($v, $max)];
    if (!is_array($v)) return ['th' => '', 'en' => ''];
    return ['th' => s_str($v['th'] ?? '', $max), 'en' => s_str($v['en'] ?? '', $max)];
}
function s_id($v): string {
    $v = strtolower(s_str($v, 64));
    $v = preg_replace('/[^a-z0-9_-]+/', '-', $v) ?? '';
    return trim($v, '-');
}
function s_hex($v, string $fallback = '#888888'): string {
    $v = s_str($v, 9);
    return preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : $fallback;
}
function s_url($v): string {
    $v = s_str($v, 500);
    return preg_match('#^https?://#i', $v) ? $v : '';
}
function s_upload_path($v, string $dir): string {
    $v = s_str($v, 300);
    if ($v === '') return '';
    if (!preg_match('#^uploads/' . $dir . '/[A-Za-z0-9._-]+$#', $v)) return '';
    return is_file(NC3D_ROOT . '/' . $v) ? $v : '';
}
function body_json(string $field) {
    $raw = $_POST[$field] ?? '';
    $d = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($d)) json_out(['ok' => false, 'error' => 'Invalid data'], 400);
    return $d;
}
function save_or_fail(array $c): void {
    if (!write_content($c)) json_out(['ok' => false, 'error' => 'Cannot write data/content.json — check permission'], 500);
    json_out(['ok' => true, 'content' => $c]);
}
function sanitize_site(array $in, array $old): array {
    $s = [];
    $s['name'] = s_str($in['name'] ?? 'NC3D', 80) ?: 'NC3D';
    $s['logo'] = s_upload_path($in['logo'] ?? '', 'images');
    $s['logoHideName'] = !empty($in['logoHideName']);
    $s['favicon'] = s_upload_path($in['favicon'] ?? '', 'images');
    $s['defaultLang'] = (($in['defaultLang'] ?? 'th') === 'en') ? 'en' : 'th';
    foreach (['tagline', 'intro', 'footer'] as $k) $s[$k] = s_i18n($in[$k] ?? '', 600);
    $s['facebookUrl'] = s_url($in['facebookUrl'] ?? '');
    $s['messengerUrl'] = s_url($in['messengerUrl'] ?? '');
    $s['orderTarget'] = (($in['orderTarget'] ?? '') === 'facebook') ? 'facebook' : 'messenger';
    $theme = is_array($in['theme'] ?? null) ? $in['theme'] : [];
    $defaults = ['primary' => '#ff5a1f', 'background' => '#f4f1ec', 'surface' => '#ffffff', 'text' => '#1d1f24', 'stage' => '#e7e2da'];
    $s['theme'] = [];
    foreach ($defaults as $k => $d) $s['theme'][$k] = s_hex($theme[$k] ?? $d, $d);
    $texts = is_array($in['texts'] ?? null) ? $in['texts'] : ($old['texts'] ?? []);
    $s['texts'] = [];
    foreach ($texts as $k => $v) {
        $key = preg_replace('/[^A-Za-z0-9_]/', '', (string)$k);
        if ($key !== '') $s['texts'][$key] = s_i18n($v, 400);
    }
    return $s;
}
function sanitize_colors(array $in): array {
    $out = []; $seen = [];
    $finishes = ['matte', 'standard', 'silk', 'glossy', 'metal', 'translucent'];
    foreach ($in as $c) {
        if (!is_array($c)) continue;
        $id = s_id($c['id'] ?? '') ?: 'c' . substr(bin2hex(random_bytes(3)), 0, 6);
        while (isset($seen[$id])) $id .= '-2';
        $seen[$id] = 1;
        $f = (string)($c['finish'] ?? 'standard');
        $out[] = [
            'id' => $id,
            'name' => s_i18n($c['name'] ?? '', 60),
            'hex' => s_hex($c['hex'] ?? ''),
            'finish' => in_array($f, $finishes, true) ? $f : 'standard',
        ];
    }
    return $out;
}
function sanitize_palettes(array $in, array $colorIds): array {
    $out = []; $seen = [];
    foreach ($in as $p) {
        if (!is_array($p)) continue;
        $id = s_id($p['id'] ?? '') ?: 'p' . substr(bin2hex(random_bytes(3)), 0, 6);
        while (isset($seen[$id])) $id .= '-2';
        $seen[$id] = 1;
        $cols = [];
        foreach ((is_array($p['colors'] ?? null) ? $p['colors'] : []) as $cid) {
            $cid = (string)$cid;
            if (isset($colorIds[$cid]) && count($cols) < 24) $cols[] = $cid;
        }
        if (!$cols) continue;
        $out[] = ['id' => $id, 'name' => s_i18n($p['name'] ?? '', 60), 'colors' => $cols];
    }
    return $out;
}
function sanitize_model(array $m, array $colorIds): array {
    $out = [
        'id' => s_id($m['id'] ?? ''),
        'visible' => !isset($m['visible']) || !empty($m['visible']),
        'name' => s_i18n($m['name'] ?? '', 120),
        'description' => s_i18n($m['description'] ?? '', 1000),
        'price' => s_i18n($m['price'] ?? '', 80),
        'file' => s_upload_path($m['file'] ?? '', 'models'),
        'thumbnail' => s_upload_path($m['thumbnail'] ?? '', 'images'),
        'zones' => [],
        'meshes' => new stdClass(),
    ];
    $zoneIds = [];
    foreach (($m['zones'] ?? []) as $z) {
        if (!is_array($z)) continue;
        $zid = s_id($z['id'] ?? '') ?: 'z' . count($zoneIds);
        if (isset($zoneIds[$zid])) continue;
        $zoneIds[$zid] = 1;
        $cols = array_values(array_filter(array_map('strval', is_array($z['colors'] ?? null) ? $z['colors'] : []), function ($id) use ($colorIds) { return isset($colorIds[$id]); }));
        $def = (string)($z['default'] ?? '');
        $out['zones'][] = [
            'id' => $zid,
            'label' => s_i18n($z['label'] ?? '', 80),
            'colors' => $cols,
            'default' => isset($colorIds[$def]) ? $def : null,
        ];
    }
    $meshes = [];
    foreach ((is_array($m['meshes'] ?? null) ? $m['meshes'] : []) as $key => $v) {
        $k = s_str((string)$key, 200);
        if ($k === '' || !is_array($v)) continue;
        $e = ['name' => s_str($v['name'] ?? '', 120)];
        if (!empty($v['hidden'])) $e['hidden'] = true;
        elseif (!empty($v['zone']) && isset($zoneIds[(string)$v['zone']])) $e['zone'] = (string)$v['zone'];
        elseif (!empty($v['color']) && isset($colorIds[(string)$v['color']])) $e['color'] = (string)$v['color'];
        $meshes[$k] = $e;
    }
    if ($meshes) $out['meshes'] = $meshes;
    return $out;
}
function file_in_use(array $c, string $path, string $exceptId = ''): bool {
    if ($path === '') return false;
    foreach ($c['models'] as $m) {
        if (($m['id'] ?? '') === $exceptId) continue;
        if (($m['file'] ?? '') === $path || ($m['thumbnail'] ?? '') === $path) return true;
    }
    $s = $c['site'];
    return ($s['logo'] ?? '') === $path || ($s['favicon'] ?? '') === $path;
}
function safe_delete(string $path): void {
    if (preg_match('#^uploads/(models|images)/[A-Za-z0-9._-]+$#', $path)) @unlink(NC3D_ROOT . '/' . $path);
}
function store_upload(string $tmp, string $kind, string $origName): string {
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    if ($kind === 'model') {
        if ($ext !== '3mf') json_out(['ok' => false, 'error' => 'Only .3mf files'], 400);
        $fh = fopen($tmp, 'rb'); $magic = $fh ? fread($fh, 4) : ''; if ($fh) fclose($fh);
        if ($magic !== "PK\x03\x04") json_out(['ok' => false, 'error' => 'Not a valid 3MF (zip) file'], 400);
        if (filesize($tmp) > NC3D_MAX_MODEL_MB * 1048576) json_out(['ok' => false, 'error' => 'File too large'], 400);
        $dir = 'models';
    } else {
        $allowed = ['png' => IMAGETYPE_PNG, 'jpg' => IMAGETYPE_JPEG, 'jpeg' => IMAGETYPE_JPEG, 'webp' => IMAGETYPE_WEBP, 'gif' => IMAGETYPE_GIF];
        if (!isset($allowed[$ext])) json_out(['ok' => false, 'error' => 'Images: png, jpg, webp, gif'], 400);
        $info = @getimagesize($tmp);
        if (!$info || $info[2] !== $allowed[$ext]) json_out(['ok' => false, 'error' => 'Invalid image file'], 400);
        if (filesize($tmp) > NC3D_MAX_IMAGE_MB * 1048576) json_out(['ok' => false, 'error' => 'Image too large'], 400);
        if ($ext === 'jpeg') $ext = 'jpg';
        $dir = 'images';
    }
    $base = s_id(pathinfo($origName, PATHINFO_FILENAME)) ?: $kind;
    $name = substr($base, 0, 40) . '-' . bin2hex(random_bytes(4)) . '.' . $ext;
    $rel = 'uploads/' . $dir . '/' . $name;
    $dest = NC3D_ROOT . '/' . $rel;
    $ok = is_uploaded_file($tmp) ? move_uploaded_file($tmp, $dest) : rename($tmp, $dest);
    if (!$ok) json_out(['ok' => false, 'error' => 'Cannot save file — check uploads/ permission'], 500);
    @chmod($dest, 0644);
    return $rel;
}

$c = read_content();
$colorIds = [];
foreach ($c['colors'] as $col) $colorIds[$col['id']] = 1;

switch ($action) {
    case 'save_site':
        $c['site'] = sanitize_site(body_json('data'), $c['site']);
        save_or_fail($c);

    case 'save_colors':
        $c['colors'] = sanitize_colors(body_json('data'));
        $ids = [];
        foreach ($c['colors'] as $col) $ids[$col['id']] = 1;
        $c['palettes'] = sanitize_palettes($c['palettes'] ?? [], $ids);
        save_or_fail($c);

    case 'save_palettes':
        $c['palettes'] = sanitize_palettes(body_json('data'), $colorIds);
        save_or_fail($c);

    case 'save_model':
        $newColorIds = $colorIds;
        $m = sanitize_model(body_json('data'), $newColorIds);
        $orig = s_id($_POST['originalId'] ?? '');
        if ($m['id'] === '') $m['id'] = 'model-' . substr(bin2hex(random_bytes(3)), 0, 6);
        if ($m['file'] === '') json_out(['ok' => false, 'error' => 'Upload a .3mf file first'], 400);
        $replaced = false;
        foreach ($c['models'] as $i => $old) {
            if (($old['id'] ?? '') === $m['id'] && $m['id'] !== $orig) json_out(['ok' => false, 'error' => 'Model ID already used'], 400);
        }
        foreach ($c['models'] as $i => $old) {
            if ($orig !== '' && ($old['id'] ?? '') === $orig) {
                // clean up files that were replaced
                foreach (['file', 'thumbnail'] as $f) {
                    $p = (string)($old[$f] ?? '');
                    if ($p !== '' && $p !== $m[$f] && !file_in_use($c, $p, $orig)) safe_delete($p);
                }
                $c['models'][$i] = $m;
                $replaced = true;
            }
        }
        if (!$replaced) $c['models'][] = $m;
        save_or_fail($c);

    case 'delete_model':
        $id = s_id($_POST['id'] ?? '');
        foreach ($c['models'] as $i => $m) {
            if (($m['id'] ?? '') === $id) {
                array_splice($c['models'], $i, 1);
                foreach (['file', 'thumbnail'] as $f) {
                    $p = (string)($m[$f] ?? '');
                    if (!file_in_use($c, $p)) safe_delete($p);
                }
                save_or_fail($c);
            }
        }
        json_out(['ok' => false, 'error' => 'Not found'], 404);

    case 'reorder_models':
        $ids = body_json('data');
        $byId = [];
        foreach ($c['models'] as $m) $byId[$m['id']] = $m;
        $new = [];
        foreach ($ids as $id) if (isset($byId[$id])) { $new[] = $byId[$id]; unset($byId[$id]); }
        $c['models'] = array_merge($new, array_values($byId));
        save_or_fail($c);

    case 'toggle_model':
        $id = s_id($_POST['id'] ?? '');
        foreach ($c['models'] as $i => $m) if (($m['id'] ?? '') === $id) $c['models'][$i]['visible'] = !empty($_POST['visible']);
        save_or_fail($c);

    case 'upload':
        $kind = ($_POST['kind'] ?? '') === 'model' ? 'model' : 'image';
        $f = $_FILES['file'] ?? null;
        if (!$f || !is_array($f) || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) {
            $err = $f['error'] ?? -1;
            $msg = in_array($err, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
                ? 'File larger than server upload limit (' . ini_get('upload_max_filesize') . '). Raise it in DirectAdmin → PHP settings.'
                : 'Upload failed (code ' . $err . ')';
            json_out(['ok' => false, 'error' => $msg], 400);
        }
        json_out(['ok' => true, 'path' => store_upload($f['tmp_name'], $kind, (string)$f['name'])]);

    case 'upload_thumb':
        $data = (string)($_POST['data'] ?? '');
        if (!preg_match('#^data:image/(png|jpeg|webp);base64,#', $data, $mm)) json_out(['ok' => false, 'error' => 'Bad image'], 400);
        $bin = base64_decode(substr($data, strpos($data, ',') + 1), true);
        if ($bin === false || strlen($bin) > 4 * 1048576) json_out(['ok' => false, 'error' => 'Bad image'], 400);
        $ext = $mm[1] === 'jpeg' ? 'jpg' : $mm[1];
        $tmp = NC3D_PRIVATE . '/.up-' . bin2hex(random_bytes(6));
        file_put_contents($tmp, $bin);
        $info = @getimagesize($tmp);
        if (!$info) { @unlink($tmp); json_out(['ok' => false, 'error' => 'Bad image'], 400); }
        json_out(['ok' => true, 'path' => store_upload($tmp, 'image', 'thumb.' . $ext)]);

    case 'delete_upload':
        // remove an uploaded file the editor no longer needs (only if unused)
        $p = s_str($_POST['path'] ?? '', 300);
        if (!file_in_use($c, $p)) safe_delete($p);
        json_out(['ok' => true]);

    case 'change_password':
        $auth = auth_data();
        $cur = (string)($_POST['current'] ?? '');
        $new = (string)($_POST['new'] ?? '');
        if (empty($auth['hash']) || !password_verify($cur, $auth['hash'])) json_out(['ok' => false, 'error' => 'Current password wrong'], 400);
        if (strlen($new) < 8) json_out(['ok' => false, 'error' => 'New password: at least 8 characters'], 400);
        if (!write_auth($new)) json_out(['ok' => false, 'error' => 'Cannot write private/auth.php'], 500);
        json_out(['ok' => true]);

    case 'restore':
        $f = $_FILES['file'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) json_out(['ok' => false, 'error' => 'Upload failed'], 400);
        $d = json_decode((string)file_get_contents($f['tmp_name']), true);
        if (!is_array($d) || !isset($d['site'], $d['colors'], $d['models'])) json_out(['ok' => false, 'error' => 'Not an NC3D backup'], 400);
        $n = ['site' => sanitize_site(is_array($d['site']) ? $d['site'] : [], [])];
        $n['colors'] = sanitize_colors(is_array($d['colors']) ? $d['colors'] : []);
        $ids = [];
        foreach ($n['colors'] as $col) $ids[$col['id']] = 1;
        $n['palettes'] = sanitize_palettes(is_array($d['palettes'] ?? null) ? $d['palettes'] : [], $ids);
        $n['models'] = [];
        foreach ((is_array($d['models']) ? $d['models'] : []) as $m) if (is_array($m)) $n['models'][] = sanitize_model($m, $ids);
        save_or_fail($n);

    case 'logout':
        $_SESSION = [];
        session_destroy();
        json_out(['ok' => true]);

    default:
        json_out(['ok' => false, 'error' => 'Unknown action'], 400);
}
