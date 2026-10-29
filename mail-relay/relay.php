<?php
declare(strict_types=1);
namespace VolturaPlacesMail;
ini_set('display_errors', '0');
// Set VOLTURA_MAIL_CONFIG, or replace this path during installation. Keep the config
// and state directory outside ALL web document roots. Never put secrets in Git.
$configPath = getenv('VOLTURA_MAIL_CONFIG') ?: '/private/voltura/places-mail-config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
function finish(int $status): never {
    http_response_code($status);
    echo json_encode(['ok' => $status === 200]);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') finish(405);
if (!is_file($configPath)) finish(503);
$config = require $configPath;
if (!is_array($config) || !preg_match('/^[a-f0-9]{64}$/D', $config['secret'] ?? '') || !is_dir($config['stateDirectory'] ?? '')) finish(503);
if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 2048) finish(413);
$body = file_get_contents('php://input', false, null, 0, 2049);
if ($body === false || strlen($body) > 2048) finish(413);
$signature = $_SERVER['HTTP_X_VOLTURA_SIGNATURE'] ?? '';
if (!preg_match('/^[a-f0-9]{64}$/D', $signature) || !hash_equals(hash_hmac('sha256', $body, $config['secret']), $signature)) finish(403);
$input = json_decode($body, true);
if (!is_array($input) || count($input) !== 4 || array_diff(array_keys($input), ['recipient', 'code', 'timestamp', 'nonce'])) finish(400);
if (!is_string($input['recipient']) || strlen($input['recipient']) > 254 || !filter_var($input['recipient'], FILTER_VALIDATE_EMAIL)
    || preg_match('/[\r\n]/', $input['recipient']) || !is_string($input['code']) || !preg_match('/^[0-9]{6}$/D', $input['code'])
    || !is_int($input['timestamp']) || abs(time() - $input['timestamp']) > 60
    || !is_string($input['nonce']) || !preg_match('/^[a-f0-9-]{36}$/D', $input['nonce'])) finish(400);
$directory = rtrim($config['stateDirectory'], '/\\');
$statePath = $directory . '/mail-state.json';
$file = fopen($directory . '/mail-state.lock', 'c+');
if ($file === false || !flock($file, LOCK_EX)) finish(503);
$stored = is_file($statePath) ? file_get_contents($statePath) : '';
$state = $stored === '' ? ['nonces' => [], 'recipients' => [], 'sent' => []] : json_decode($stored, true);
if (!is_array($state) || !is_array($state['nonces'] ?? null) || !is_array($state['recipients'] ?? null) || !is_array($state['sent'] ?? null)) {
    flock($file, LOCK_UN); fclose($file); finish(503);
}
$now = time();
$state['nonces'] = array_filter($state['nonces'], fn($time) => $time > $now - 120);
$state['recipients'] = array_filter($state['recipients'], fn($times) => $times && max($times) > $now - 3600);
$state['sent'] = array_values(array_filter($state['sent'], fn($time) => $time > $now - 3600));
$recipient = hash_hmac('sha256', strtolower($input['recipient']), $config['secret']);
$times = array_values(array_filter($state['recipients'][$recipient] ?? [], fn($time) => $time > $now - 3600));
if (isset($state['nonces'][$input['nonce']])) { flock($file, LOCK_UN); fclose($file); finish(409); }
// Conservative limits below one.com's PHP mail ceiling; no arbitrary templates/headers.
if (($times && max($times) > $now - 60) || count($times) >= 6 || count($state['sent']) >= 120
    || count(array_filter($state['sent'], fn($time) => $time > $now - 60)) >= 20) {
    flock($file, LOCK_UN); fclose($file); header('Retry-After: 60'); finish(429);
}
$state['nonces'][$input['nonce']] = $now;
$times[] = $now; $state['recipients'][$recipient] = $times; $state['sent'][] = $now;
$encoded = json_encode($state, JSON_THROW_ON_ERROR);
$temporary = tempnam($directory, '.mail-state-');
if ($temporary === false) { flock($file, LOCK_UN); fclose($file); finish(503); }
chmod($temporary, 0600);
if (file_put_contents($temporary, $encoded) !== strlen($encoded) || !rename($temporary, $statePath)) {
    if (is_file($temporary)) unlink($temporary);
    flock($file, LOCK_UN); fclose($file); finish(503);
}
flock($file, LOCK_UN); fclose($file);
$text = "Your Voltura Places sign-in code is: " . $input['code'] . "\n\nThis code expires in five minutes and can be used once.\nIf you did not request it, ignore this email.\n\nVoltura Places\nhttps://places.voltura.se/\n";
$headers = ['From' => 'Voltura Places <places@voltura.se>', 'Content-Type' => 'text/plain; charset=UTF-8', 'MIME-Version' => '1.0'];
$sent = mail($input['recipient'], 'Your Voltura Places sign-in code', $text, $headers);
finish($sent ? 200 : 503);
