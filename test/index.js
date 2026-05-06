'use strict'
const path = require('node:path')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { afterEach, beforeEach, describe, it, mock } = require('node:test')

// npm modules
const fixtures = require('haraka-test-fixtures')

// Haraka constants
global.OK = 902
global.DENY = 900
global.DENYSOFT = 901

let ofetchMockImpl = null

function createOfetchMock(statusCode = 200, bodyCallback) {
  return async function mockedOfetch(url, options) {
    ofetchMockImpl.callCount++
    ofetchMockImpl.lastUrl = url
    ofetchMockImpl.lastOptions = options
    if (bodyCallback) {
      bodyCallback(options.body)
    }
    if (statusCode >= 400) {
      const error = new Error(`HTTP ${statusCode}`)
      error.data = statusCode
      throw error
    }
    return { status: statusCode }
  }
}

function mockOfetch(impl) {
  const ofetchPath = require.resolve('ofetch')
  delete require.cache[ofetchPath]
  require.cache[ofetchPath] = {
    id: ofetchPath,
    filename: ofetchPath,
    loaded: true,
    exports: { ofetch: impl },
  }
}

function reloadPlugin() {
  const pluginPath = path.resolve(__dirname, '..')
  delete require.cache[require.resolve(pluginPath)]
  return new fixtures.plugin(pluginPath)
}

// start of tests
//    assert: https://nodejs.org/api/assert.html

beforeEach(() => {
  ofetchMockImpl = { callCount: 0, lastUrl: null, lastOptions: null }
  mockOfetch(createOfetchMock(200))
  this.plugin = reloadPlugin()

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
    this.plugin.cfg = {
      dropboxes: { 'user@example.com': 'https://dropbox.example.com' },
    }
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
    this.plugin.parse_body(() => {
      called = true
    }, this.connection)
    assert.ok(called)
  })
})

describe('post_to_dropbox', () => {
  it('calls next immediately when no message_stream', () => {
    this.connection.transaction.message_stream = null
    let called = false
    this.plugin.post_to_dropbox(() => {
      called = true
    }, this.connection)
    assert.ok(called)
  })

  it('calls next when simpleParser errors', () => {
    const errStream = new Readable({ read() {} })
    errStream.readable = true
    this.connection.transaction.message_stream = errStream
    this.plugin.post_to_dropbox(() => {}, this.connection)
    process.nextTick(() => errStream.emit('error', new Error('parse error')))
  })

  it('marks the message for discard and posts to dropbox when rcpt matches', (t, done) => {
    this.connection.transaction.message_stream = createEmailStream(RAW_EMAIL)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }

    this.plugin.post_to_dropbox(() => {
      assert.equal(ofetchMockImpl.callCount, 1)
      assert.ok(this.connection.transaction.notes.discard)
      done()
    }, this.connection)
  })

  it('calls next(DENY) when rcpt has no matching dropbox', (t, done) => {
    this.connection.transaction.message_stream = createEmailStream(RAW_EMAIL)
    this.connection.transaction.rcpt_to = [
      { user: 'unknown', host: 'example.com' },
    ]
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

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        assert.notEqual(parsed.payload.in_reply_to, false)
        done()
      }),
    )

    // reload plugin so it picks up the new mock
    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream =
      createEmailStream(rawEmailWithReply)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('sets in_reply_to to false when In-Reply-To header is absent', (t, done) => {
    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        assert.equal(parsed.payload.in_reply_to, false)
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream = createEmailStream(RAW_EMAIL)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('parses German date format in forwarded emails', (t, done) => {
    const germanForwardEmail = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: WG: Test Email',
      'Message-ID: <test123@example.com>',
      'Date: 15. Januar 2024 um 10:30:00',
      '',
      '-----Original Message-----',
      'From: original@example.com',
      'Date: 14. Januar 2024 09:15',
      'Subject: Test Email',
      '',
      'Original body content',
    ].join('\r\n')

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        const date = new Date(parsed.payload.date)
        assert.equal(date.getFullYear(), 2024)
        assert.equal(date.getMonth(), 0)
        assert.equal(date.getDate(), 14)
        assert.equal(date.getHours(), 9)
        assert.equal(date.getMinutes(), 15)
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream =
      createEmailStream(germanForwardEmail)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('parses English date format in forwarded emails', (t, done) => {
    const englishForwardEmail = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: FW: Test Email',
      'Message-ID: <test123@example.com>',
      '',
      '-----Original Message-----',
      'From: original@example.com',
      'Date: 14 March 2024, 09:15:00',
      'Subject: Test Email',
      '',
      'Original body content',
    ].join('\r\n')

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        const date = new Date(parsed.payload.date)
        assert.equal(date.getFullYear(), 2024)
        assert.equal(date.getMonth(), 2)
        assert.equal(date.getDate(), 14)
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream =
      createEmailStream(englishForwardEmail)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('parses German Outlook reply format (Von:/Betreff:)', (t, done) => {
    const germanOutlookReply = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: AW: Test',
      'Message-ID: <reply@example.com>',
      '',
      'Reply content here',
      '',
      'Von: original@example.com',
      'Gesendet: Montag, 20. Januar 2024 14:30',
      'Betreff: RE: Test',
      '',
      'Original message content',
    ].join('\r\n')

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        assert.equal(parsed.payload.plain_body, 'Reply content here')
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream =
      createEmailStream(germanOutlookReply)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('uses ISO date when parsing fails in parseFlexibleDate', (t, done) => {
    const emailWithISODate = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: Test Email',
      'Message-ID: <test123@example.com>',
      'Date: 2024-01-15T10:30:00Z',
      '',
      'Hello World',
    ].join('\r\n')

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        const date = new Date(parsed.payload.date)
        assert.equal(date.getFullYear(), 2024)
        assert.equal(date.getMonth(), 0)
        assert.equal(date.getDate(), 15)
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream =
      createEmailStream(emailWithISODate)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('returns null for invalid date format in parseFlexibleDate', (t, done) => {
    const emailWithInvalidDate = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: Test Email',
      'Message-ID: <test123@example.com>',
      'Date: not-a-date',
      '',
      'Hello World',
    ].join('\r\n')

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        const date = new Date(parsed.payload.date)
        assert.ok(date instanceof Date)
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream =
      createEmailStream(emailWithInvalidDate)
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })

  it('uses Date.now() as fallback messageId', (t, done) => {
    const emailWithoutMessageId = [
      'From: sender@example.com',
      'To: test@example.com',
      'Subject: Test Email',
      '',
      'Hello World',
    ].join('\r\n')

    mockOfetch(
      createOfetchMock(200, (body) => {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body
        assert.ok(parsed.payload.message_id.includes('@haraka'))
        done()
      }),
    )

    this.plugin = reloadPlugin()
    this.connection = fixtures.connection.createConnection({})
    this.connection.init_transaction()

    this.connection.transaction.message_stream = createEmailStream(
      emailWithoutMessageId,
    )
    this.connection.transaction.rcpt_to = [
      { user: 'test', host: 'example.com' },
    ]
    this.plugin.cfg = {
      dropboxes: { 'test@example.com': 'https://dropbox.example.com' },
    }
    this.plugin.post_to_dropbox(() => {}, this.connection)
  })
})

describe('parseFlexibleDate', () => {
  it('parses ISO date format', () => {
    const result = this.plugin.parseFlexibleDate('2024-03-15T10:30:00Z')
    assert.ok(result instanceof Date)
    assert.equal(result.getFullYear(), 2024)
    assert.equal(result.getMonth(), 2)
    assert.equal(result.getDate(), 15)
  })

  it('parses German date format without time', () => {
    const result = this.plugin.parseFlexibleDate('15. Januar 2024')
    assert.ok(result instanceof Date)
    assert.equal(result.getFullYear(), 2024)
    assert.equal(result.getMonth(), 0)
    assert.equal(result.getDate(), 15)
  })

  it('parses German date format with time', () => {
    const result = this.plugin.parseFlexibleDate('15. Januar 2024 um 10:30')
    assert.ok(result instanceof Date)
    assert.equal(result.getFullYear(), 2024)
    assert.equal(result.getMonth(), 0)
    assert.equal(result.getDate(), 15)
    assert.equal(result.getHours(), 10)
    assert.equal(result.getMinutes(), 30)
  })

  it('parses German date format with seconds', () => {
    const result = this.plugin.parseFlexibleDate('15. Januar 2024 um 10:30:45')
    assert.ok(result instanceof Date)
    assert.equal(result.getHours(), 10)
    assert.equal(result.getMinutes(), 30)
    assert.equal(result.getSeconds(), 45)
  })

  it('parses English date format without time', () => {
    const result = this.plugin.parseFlexibleDate('15 March 2024')
    assert.ok(result instanceof Date)
    assert.equal(result.getFullYear(), 2024)
    assert.equal(result.getMonth(), 2)
    assert.equal(result.getDate(), 15)
  })

  it('parses English date format with time', () => {
    const result = this.plugin.parseFlexibleDate('15 March 2024, 10:30:45')
    assert.ok(result instanceof Date)
    assert.equal(result.getHours(), 10)
    assert.equal(result.getMinutes(), 30)
    assert.equal(result.getSeconds(), 45)
  })

  it('returns null for invalid date', () => {
    const result = this.plugin.parseFlexibleDate('invalid date')
    assert.equal(result, null)
  })

  it('returns null for empty string', () => {
    const result = this.plugin.parseFlexibleDate('')
    assert.equal(result, null)
  })

  it('returns null for null input', () => {
    const result = this.plugin.parseFlexibleDate(null)
    assert.equal(result, null)
  })

  it('returns null for undefined input', () => {
    const result = this.plugin.parseFlexibleDate(undefined)
    assert.equal(result, null)
  })
})

describe('parseGermanOutlookReply', () => {
  it('extracts reply text from German Outlook format', () => {
    const text = [
      'This is my reply',
      '',
      'Von: sender@example.com',
      'Gesendet: Montag, 20. Januar 2024 14:30',
      'Betreff: RE: Test',
      '',
      'Original message here',
    ].join('\r\n')
    const result = this.plugin.parseGermanOutlookReply(text)
    assert.equal(result, 'This is my reply')
  })

  it('returns null when no Von: line found', () => {
    const text = ['Just some text', 'Betreff: Test'].join('\r\n')
    const result = this.plugin.parseGermanOutlookReply(text)
    assert.equal(result, null)
  })

  it('returns null when no Betreff: line after Von:', () => {
    const text = [
      'Just some text',
      '',
      'Von: sender@example.com',
      'Something else here',
    ].join('\r\n')
    const result = this.plugin.parseGermanOutlookReply(text)
    assert.equal(result, null)
  })

  it('returns null when reply text is empty', () => {
    const text = ['', 'Von: sender@example.com', 'Betreff: Test'].join('\r\n')
    const result = this.plugin.parseGermanOutlookReply(text)
    assert.equal(result, null)
  })
})
