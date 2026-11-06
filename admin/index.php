<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
nc3d_session();
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');

if (!is_setup()) { header('Location: setup.php'); exit; }

$error = '';
if (!is_logged_in() && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $wait = login_blocked();
    if ($wait > 0) {
        $error = 'Too many attempts. Wait ' . ceil($wait / 60) . ' min. / ลองผิดหลายครั้ง รอ ' . ceil($wait / 60) . ' นาที';
    } elseif (!check_csrf()) {
        $error = 'Session expired, try again / หมดเวลา ลองใหม่';
    } else {
        $auth = auth_data();
        if (!empty($auth['hash']) && password_verify((string)($_POST['password'] ?? ''), $auth['hash'])) {
            login_ok();
            header('Location: ./');
            exit;
        }
        login_fail();
        usleep(400000);
        $error = 'Wrong password / รหัสผ่านไม่ถูกต้อง';
    }
}

if (!is_logged_in()): ?><!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NC3D Admin</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="admin.css">
</head><body class="auth-page">
<form class="auth-card" method="post">
  <h1>NC3D Admin</h1>
  <?php if ($error): ?><p class="error"><?= h($error) ?></p><?php endif; ?>
  <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
  <label>Password / รหัสผ่าน<input type="password" name="password" required autofocus></label>
  <button class="btn primary" type="submit">Log in / เข้าสู่ระบบ</button>
  <a class="muted small" href="../">← Back to site</a>
</form>
</body></html>
<?php exit; endif; ?><!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NC3D Admin</title><meta name="robots" content="noindex">
<meta name="csrf" content="<?= h(csrf_token()) ?>">
<meta name="upload-limit" content="<?= (int)upload_limit_bytes() ?>">
<link rel="icon" href="../assets/img/favicon.svg">
<link rel="stylesheet" href="admin.css">
<script type="importmap">
{ "imports": { "three": "../assets/vendor/three/three.module.min.js", "three/addons/": "../assets/vendor/three/addons/" } }
</script>
</head><body>
<header class="adm-top">
  <b>NC3D Admin</b>
  <nav id="tabs">
    <button data-tab="models" class="on">Models / โมเดล</button>
    <button data-tab="colors">Colors &amp; palettes / สี</button>
    <button data-tab="site">Site / หน้าเว็บ</button>
    <button data-tab="texts">Texts / ข้อความ</button>
    <button data-tab="account">Account / บัญชี</button>
  </nav>
  <a class="btn small" href="../" target="_blank">View site ↗</a>
</header>
<main id="app" class="adm-main"><p class="muted">Loading…</p></main>
<div class="toast" id="toast"></div>
<script type="module" src="admin.js"></script>
</body></html>
