'use strict'
const https = require('node:https')
const http = require('node:http')
const { URL } = require('node:url')
const simpleParser = require('mailparser').simpleParser
const DSN = require('haraka-dsn')
const EmailReplyParser = require('email-reply-parser').default
const safeStringify = require('safe-stringify').default
const EmailForwardParser = require('email-forward-parser')
const chrono = require('chrono-node')

exports.register = function () {
  this.load_dropbox_ini()

  // register hooks here. More info at https://haraka.github.io/core/Plugins/
  this.register_hook('rcpt', 'check_rcpt')
  this.register_hook('data', 'parse_body')
  this.register_hook('data_post', 'post_to_dropbox')
}

exports.check_rcpt = function (next, connection, params) {
  const rcpt_to = `${params[0].user}@${params[0].host}`
  const url = this.cfg.dropboxes[rcpt_to]
  if (url) {
    next(OK)
  } else {
    next(DENY, DSN.no_such_user())
  }
}

exports.parse_body = function (next, connection) {
  connection.transaction.parse_body = true
  return next()
}

exports.post_to_dropbox = function (next, connection) {
  const plugin = this
  plugin.loginfo('hook_data_post called')

  if (!connection.transaction.message_stream) {
    plugin.logerror('No message_stream available')
    return next()
  }

  plugin.loginfo(
    'message_stream type: ' + typeof connection.transaction.message_stream,
  )
  plugin.loginfo(
    'message_stream readable: ' +
      connection.transaction.message_stream.readable,
  )

  simpleParser(connection.transaction.message_stream, (err, mail) => {
    if (err) {
      plugin.logerror('simpleParser error: ' + err)
      return next()
    }

    plugin.loginfo('simpleParser completed')
    const messageId = mail.messageId || Date.now() + '@haraka'

    let rcpt_to

    if (
      !!connection.transaction.rcpt_to &&
      connection.transaction.rcpt_to.length > 0
    ) {
      const rcpt = connection.transaction.rcpt_to[0]
      rcpt_to = `${rcpt.user}@${rcpt.host}`
    }
    const url = plugin.cfg.dropboxes[rcpt_to]
    if (url) {
      let plain_body
      let subject = mail.subject
      let from = mail.from?.value?.map((item) => item.address)[0] || ''
      const text_body = mail.text
        ? mail.text
        : mail.html.replace(/<[^>]*>/g, '')
      const replayParser = new EmailReplyParser()

      let to = mail.to?.value?.map((item) => item.address) || []

      let date =
        mail.date instanceof Date && !isNaN(mail.date)
          ? mail.date
          : parseFlexibleDate(mail.date) || new Date()

      const forwardResult = new EmailForwardParser().read(
        text_body,
        mail.subject,
      )
      if (forwardResult.forwarded) {
        subject = forwardResult.email.subject || mail.subject
        from = forwardResult.email.from.address
        to = forwardResult.email.to.map((item) => item.address)
        plugin.loginfo(forwardResult.email.date)
        if (forwardResult.email.date) {
          const parsedDate = parseFlexibleDate(forwardResult.email.date)
          if (parsedDate) {
            date = parsedDate
          }
        }
        const germanReplyResult = parseGermanOutlookReply(
          forwardResult.email.body,
        )
        if (germanReplyResult) {
          plain_body = germanReplyResult
        } else {
          plain_body = replayParser.parseReply(forwardResult.email.body)
        }
      } else {
        const germanReplyResult = parseGermanOutlookReply(text_body)
        if (germanReplyResult) {
          plain_body = germanReplyResult
        } else {
          plain_body = replayParser.parseReply(text_body)
        }
      }

      const _email = {
        from: from || '',
        to,
        rcpt_to: rcpt_to,
        cc: mail.cc?.value?.map((item) => item.address) || [],
        bcc: mail.bcc?.value?.map((item) => item.address) || [],
        subject: subject,
        message_id: messageId,
        attachments: (mail.attachments || []).map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          contentDisposition: a.contentDisposition,
          contentId: a.contentId || null,
          size: a.size,
          content: a.content ? a.content.toString('base64') : null,
        })),
        plain_body: plain_body,
        html: mail.html ? mail.html : mail.textAsHtml,
        text: text_body,
        text_as_html: mail.textAsHtml,
        date,
        references: mail.references || [],
      }

      _email.in_reply_to =
        !!mail.inReplyTo && mail.inReplyTo.length > 0 ? mail.inReplyTo : false

      const body = JSON.stringify({ payload: _email })
      const parsedUrl = new URL(url)
      const lib = parsedUrl.protocol === 'https:' ? https : http
      const req = lib.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            plugin.logerror(`Dropbox post failed: HTTP ${res.statusCode}`)
            return next(DENYSOFT, 'Dropbox webhook temporarily unavailable')
          }
          res.resume()
          connection.transaction.notes.discard = [1 | true]
          next()
        },
      )
      req.setTimeout(10000, () => req.destroy(new Error('timeout')))
      req.on('error', (err) => {
        plugin.logerror(`Dropbox post failed: ${err.message}`)
        next(DENYSOFT, 'Dropbox webhook temporarily unavailable')
      })
      req.write(body)
      req.end()
    } else {
      next(DENY, DSN.no_such_user())
    }
  })
}

const chronoParsers = [
  chrono,
  chrono.de,
  chrono.fr,
  chrono.pt,
  chrono.ja,
  chrono.zh,
]

const parseFlexibleDate = function (dateStr) {
  if (!dateStr) return null
  if (dateStr instanceof Date) return isNaN(dateStr) ? null : dateStr
  if (typeof dateStr !== 'string') return null
  for (const parser of chronoParsers) {
    const results = parser.parse(dateStr)
    if (results.length > 0 && results[0].start.isCertain('year')) {
      return results[0].date()
    }
  }
  return null
}
exports.parseFlexibleDate = parseFlexibleDate

const parseGermanOutlookReply = function (text) {
  if (typeof text !== 'string' || !text.length) return null
  const lines = text.split(/\r?\n/)
  let vonIndex = -1
  let betreffIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (vonIndex < 0 && /^Von:\s+/i.test(line)) {
      vonIndex = i
    }

    if (vonIndex >= 0 && /^Betreff:\s*/i.test(line)) {
      betreffIndex = i
      break
    }
  }

  if (vonIndex >= 0 && betreffIndex >= 0) {
    const replyText = lines.slice(0, vonIndex).join('\n').trim()
    if (replyText) return replyText
  }

  return null
}
exports.parseGermanOutlookReply = parseGermanOutlookReply

exports.load_dropbox_ini = function () {
  this.cfg = this.config.get(
    'dropbox.ini',
    {
      booleans: [
        '+enabled', // this.cfg.main.enabled=true
        '-disabled', // this.cfg.main.disabled=false
        '+feature_section.yes', // this.cfg.feature_section.yes=true
      ],
    },
    () => {
      // This closure is run a few seconds after dropbox.ini changes
      // Re-run the outer function again
      this.load_dropbox_ini()
    },
  )
}
