<?php
declare(strict_types=1);
require __DIR__ . '/lib.php';
nc3d_session();

$error = '';
$done = is_setup();
$checks = writable_report();
$allOk = !in_array(false, $checks, true);

if (!$done && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $p1 = (string)($_POST['password'] ?? '');
    $p2 = (string)($_POST['password2'] ?? '');
    if (!check_csrf()) $error = 'Session expired, try again / หมดเวลา ลองใหม่';
    elseif (strlen($p1) < 8) $error = 'Password must be at least 8 characters / รหัสผ่านอย่างน้อย 8 ตัว';
    elseif ($p1 !== $p2) $error = 'Passwords do not match / รหัสผ่านไม่ตรงกัน';
    elseif (!$allOk) $error = 'Some folders are not writable / บางโฟลเดอร์เขียนไม่ได้';
    elseif (!write_auth($p1)) $error = 'Cannot write private/auth.php — check folder permission 755';
    else {
        login_ok();
        header('Location: ./');
        exit;
    }
}
?><!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NC3D Setup</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="admin.css">
</head><body class="auth-page">
<form class="auth-card" method="post" autocomplete="off">
  <h1>NC3D Setup</h1>
  <?php if ($done): ?>
    <p>Setup already done. ตั้งค่าเรียบร้อยแล้ว</p>
    <p class="muted">Forgot password? Delete <code>private/auth.php</code> in DirectAdmin File Manager, then open this page again.<br>ลืมรหัส? ลบไฟล์ <code>private/auth.php</code> ใน File Manager แล้วเปิดหน้านี้ใหม่</p>
    <a class="btn primary" href="./">Go to admin / ไปหน้าแอดมิน</a>
  <?php else: ?>
    <p class="muted">Create your admin password. สร้างรหัสผ่านแอดมิน</p>
    <ul class="checks">
      <?php foreach ($checks as $label => $ok): ?>
        <li class="<?= $ok ? 'ok' : 'bad' ?>"><?= $ok ? '✓' : '✗' ?> <code><?= h($label) ?></code> <?= $ok ? 'writable' : 'NOT writable — set permission 755 (folder) / 644 (file)' ?></li>
      <?php endforeach; ?>
    </ul>
    <?php if ($error): ?><p class="error"><?= h($error) ?></p><?php endif; ?>
    <input type="hidden" name="csrf" value="<?= h(csrf_token()) ?>">
    <label>Password / รหัสผ่าน<input type="password" name="password" minlength="8" required></label>
    <label>Confirm / ยืนยันรหัสผ่าน<input type="password" name="password2" minlength="8" required></label>
    <button class="btn primary" type="submit">Create / สร้าง</button>
  <?php endif; ?>
</form>
</body></html>
