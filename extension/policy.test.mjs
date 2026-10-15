import test from 'node:test'
import assert from 'node:assert/strict'
import { trustedPage, deviceOrigin, operation, validateWrite, scanOrigins } from './policy.js'

test('only the production SignalShade path is trusted', () => {
  assert.equal(trustedPage('https://inertiaimpact.github.io/SignalShade/'), true)
  for (const u of [
    'http://inertiaimpact.github.io/SignalShade/',
    'https://evil.example/SignalShade/',
    'https://inertiaimpact.github.io/other/',
    'https://inertiaimpact.github.io/SignalShade-evil/',
  ])
    assert.equal(trustedPage(u), false)
})
test('range permission is bounded to the requested private /24 and excludes network/broadcast', () => {
  const origins = scanOrigins('http://10.215.20.1', 'http://10.215.20.255')
  assert.equal(origins.length, 254)
  assert.equal(origins.at(-1), 'http://10.215.20.254')
  for (const [start, end] of [
    ['http://10.1.1.1', 'http://10.1.2.1'],
    ['http://10.1.1.10', 'http://10.1.1.1'],
    ['http://8.8.8.1', 'http://8.8.8.9'],
    ['http://10.1.1.1:80', 'https://10.1.1.9'],
  ])
    assert.throws(() => scanOrigins(start, end))
  assert.equal(operation('device-info').kind, 'identity')
})
test('restricts target origins to RFC1918 literals and preserves exact ports', () => {
  assert.equal(deviceOrigin('http://10.215.20.220:8080'), 'http://10.215.20.220:8080')
  assert.equal(deviceOrigin('https://192.168.1.3/'), 'https://192.168.1.3')
  for (const u of [
    'http://127.0.0.1',
    'http://169.254.169.254',
    'http://8.8.8.8',
    'http://localhost',
    'file:///etc/passwd',
    'http://user:pass@10.1.1.1',
    'http://10.1.1.1/config',
    'http://10.1.1.1/?x=1',
    'http://10.1.1.1/#x',
  ])
    assert.throws(() => deviceOrigin(u))
})
test('rejects arbitrary paths, duplicated query keys, and invalid writes', () => {
  assert.deepEqual(operation('config?action=get&paramid=eParamID_ProductID'), {
    kind: 'read',
    id: 'eParamID_ProductID',
  })
  for (const p of [
    'https://example.com',
    '/config',
    'config?action=get&action=set&paramid=eParamID_ProductID',
    'config?action=set&paramid=eParamID_TransportCommand&value=NaN&configid=0',
    'config?action=get&paramid=eParamID_ProductID&value=1',
  ])
    assert.throws(() => operation(p))
})
test('only allows descriptor-verified record/stop and shading values', () => {
  const list = [
    {
      param_id: 'eParamID_ReplicatorCommand',
      enum_values: [
        { value: 1, text: 'Record Command' },
        { value: 2, text: 'Stop Recording Command' },
        { value: 3, text: 'Stream Command' },
      ],
    },
    { param_id: 'eParamID_Gain', param_name: 'Video 1 Proc Amp Gain', min_value: 0, max_value: 2 },
    { param_id: 'eParamID_Format', param_name: 'Format Media', min_value: 0, max_value: 1 },
  ]
  validateWrite({ id: 'eParamID_ReplicatorCommand', value: 1 }, list)
  validateWrite({ id: 'eParamID_Gain', value: 1.2 }, list)
  for (const op of [
    { id: 'eParamID_ReplicatorCommand', value: 3 },
    { id: 'eParamID_Gain', value: 5 },
    { id: 'eParamID_Format', value: 1 },
    { id: 'unknown', value: 1 },
  ])
    assert.throws(() => validateWrite(op, list))
})
