'use strict'
const path = require('node:path')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { afterEach, beforeEach, describe, it, mock } = require('node:test')

// npm modules
const fixtures = require('haraka-test-fixtures')
const axios = require('axios')

// start of tests
//    assert: https://nodejs.org/api/assert.html

beforeEach(() => {
  this.plugin = new fixtures.plugin(path.join(__dirname, '..'))

  // replace vm-compiled fns with instrumented copies for coverage tracking
  if (process.env.HARAKA_COVERAGE) {
    const plugin_module = require('../index.js')
    Object.assign(this.plugin, plugin_module)
  }

  this.connection = fixtures.connection.createConnection({})
  this.connection.init_transaction()
})

afterEach(() => {
  mock.restoreAll()
})

const RAW_EMAIL = [
  'From: sender@example.com',
  'To: test@example.com',
  'Subject: Test Email',
  'Message-ID: <test123@example.com>',
  '',
  'Hello World',
].join('\r\n')

function createEmailStream(rawEmail) {
  const stream = new Readable({ read() {} })
  stream.push(Buffer.from(rawEmail))
  stream.push(null)
  return stream
}

describe('register', () => {
  it('has a register function', () => {
    assert.equal('function', typeof this.plugin.register)
  })

  it('registers', () => {
    const expected_cfg = {
      main: {
        disabled: false,
        enabled: true,
      },
      feature_section: {
        yes: true,
      },
      dropboxes: {
        'dropbox@example.com': 'https://',
      },
    }

    assert.deepEqual(this.plugin.cfg, undefined)
    this.plugin.register()
    assert.deepEqual(this.plugin.cfg, expected_cfg)
  })
})

describe('load_dropbox_ini', () => {
  it('loads', () => {
    assert.equal('object', typeof this.plugin)
  })

  it('loads dropbox.ini from config/dropbox.ini', () => {
    this.plugin.load_dropbox_ini()
    assert.ok(this.plugin.cfg)
  })

  it('initializes enabled boolean', () => {
    this.plugin.load_dropbox_ini()
    assert.equal(this.plugin.cfg.main.enabled, true, this.plugin.cfg)
  })
})

describe('uses text fixtures', () => {
  it('sets up a connection', () => {
    this.connection = fixtures.connection.createConnection({})
    assert.ok(this.connection.server)
  })

  it('sets up a transaction', () => {
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()
    assert.ok(this.connection.transaction.header)
  })
})

describe('check_rcpt', () => {
  it('calls next(OK) when rcpt is found in dropboxes', () => {
    this.plugin.cfg = { dropboxes: { 'user@example.com': 'https://dropbox.example.com' } }
    let called_with
    this.plugin.check_rcpt(
      (code) => {
        called_with = code
      },
      this.connection,
      [{ user: 'user', host: 'example.com' }],
    )
    assert.equal(called_with, OK)
  })

  it('calls next(DENY) when rcpt is not in dropboxes', () => {
    this.plugin.cfg = { dropboxes: {} }
    let called_with
    this.plugin.check_rcpt(
      (code) => {
        called_with = code
      },
      this.connection,
      [{ user: 'unknown', host: 'example.com' }],
    )
    assert.equal(called_with, DENY)
  })
})

describe('parse_body', () => {
  it('sets transaction.parse_body to true', () => {
    this.plugin.parse_body(() => {}, this.connection)
    assert.equal(this.connection.transaction.parse_body, true)
  })

  it('calls next', () => {
    let called = false
    this.plugin.parse_body(
      () => {
        called = true
      },
      this.connection,
    )
    assert.ok(called)
  })
})

describe('post_to_dropbox', () => {
  it('calls next immediately when no message_stream', (t, done) => {
    this.connection.transaction.message_stream = null
    this.plugin.post_to_dropbox(done, this.connection)
  })

  it('calls next when simpleParser errors', (t, done) => {
    const errStream = new Readable({ read() {} })
    errStream.readable = true
    this.connection.transaction.message_stream = errStream
    this.plugin.post_to_dropbox(() => done(), this.connection)
    process.nextTick(() => errStream.emit('error', new Error('parse error')))
  })

  it('calls next(OK) and posts to dropbox when rcpt matches', (t, done) => {
    const axiosMock = mock.method(axios, 'post', () => Promise.resolve({}))
    this.connection.transaction.message_stream = createEmailStream(RAW_EMAIL)
    this.connection.transaction.rcpt_to = [{ user: 'test', host: 'example.com' }]
    this.plugin.cfg = { dropboxes: { 'test@example.com': 'https://dropbox.example.com' } }

    this.plugin.post_to_dropbox((code) => {
      assert.equal(code, OK)
      assert.equal(axiosMock.mock.calls.length, 1)
      assert.equal(axiosMock.mock.calls[0].arguments[0], 'https://dropbox.example.com')
      done()
    }, this.connection)
  })

  it('calls next(DENY) when rcpt has no matching dropbox', (t, done) => {
    this.connection.transaction.message_stream = createEmailStream(RAW_EMAIL)
    this.connection.transaction.rcpt_to = [{ user: 'unknown', host: 'example.com' }]
    this.plugin.cfg = { dropboxes: {} }

    this.plugin.post_to_dropbox((code) => {
      assert.equal(code, DENY)
      done()
    }, this.connection)
  })

  it('sets in_reply_to when In-Reply-To header is present', (t, done) => {
    const rawEmailWithReply = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: Re: Test',
      'Message-ID: <reply@example.com>',
      'In-Reply-To: <original@example.com>',
      '',
      'Reply body',
    ].join('\r\n')

    mock.method(axios, 'post', (url, body) => {
      assert.notEqual(body.payload.in_reply_to, false)
      done()
      return Promise.resolve({})
    })

    this.connection.transaction.message_stream = createEmailStream(rawEmailWithReply)
    this.connection.transaction.rcpt_to = [{ user: 'test', host: 'example.com' }]
    this.plugin.cfg = { dropboxes: { 'test@example.com': 'https://dropbox.example.com' } }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('sets in_reply_to to false when In-Reply-To header is absent', (t, done) => {
    mock.method(axios, 'post', (url, body) => {
      assert.equal(body.payload.in_reply_to, false)
      done()
      return Promise.resolve({})
    })

    this.connection.transaction.message_stream = createEmailStream(RAW_EMAIL)
    this.connection.transaction.rcpt_to = [{ user: 'test', host: 'example.com' }]
    this.plugin.cfg = { dropboxes: { 'test@example.com': 'https://dropbox.example.com' } }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })
})
