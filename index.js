'use strict'
const axios = require('axios')
const simpleParser = require('mailparser').simpleParser
const DSN = require('haraka-dsn')
const EmailReplyParser = require('email-reply-parser').default
const safeStringify = require('safe-stringify').default
const EmailForwardParser = require('email-forward-parser')

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

      let date =
        mail.date instanceof Date && !isNaN(mail.date)
          ? mail.date
          : parseFlexibleDate(mail.date) || new Date()

      const forwardResult = new EmailForwardParser().read(
        text_body,
        mail.subject,
      )

      plugin.loginfo(safeStringify({ ...mail, date: date.toISOString() }))

      if (forwardResult.forwarded) {
        subject = forwardResult.email.subject || mail.subject
        from = forwardResult.email.from.address
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
        to: mail.to?.value?.map((item) => item.address) || [],
        rcpt_to: rcpt_to,
        cc: mail.cc?.value?.map((item) => item.address) || [],
        bcc: mail.bcc?.value?.map((item) => item.address) || [],
        subject: subject,
        message_id: messageId,
        attachments: mail.attachments || [],
        plain_body: plain_body,
        html: mail.html ? mail.html : mail.textAsHtml,
        text: text_body,
        text_as_html: mail.textAsHtml,
        date,
        references: mail.references || [],
      }

      _email.in_reply_to =
        !!mail.inReplyTo && mail.inReplyTo.length > 0 ? mail.inReplyTo : false

      axios
        .post(url, { payload: _email }, { timeout: 10000 })
        .then(() => {
          connection.transaction.notes.discard = [1 | true]
          next()
        })
        .catch((err) => {
          plugin.logerror(`Dropbox post failed: ${err.message}`)
          next(DENYSOFT, 'Dropbox webhook temporarily unavailable')
        })
    } else {
      next(DENY, DSN.no_such_user())
    }
  })
}

function parseFlexibleDate(dateStr) {
  if (!dateStr) return null

  const parsed = new Date(dateStr)
  if (parsed instanceof Date && !isNaN(parsed)) {
    return parsed
  }

  const germanMatch = dateStr.match(
    /(\d{1,2})\.\s*(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})\s*(?:um\s*)?(\d{1,2}:\d{2}(?::\d{2})?)?/i,
  )
  if (germanMatch) {
    const germanMonths = {
      januar: 0,
      märz: 2,
      april: 3,
      mai: 4,
      juni: 5,
      juli: 6,
      august: 7,
      september: 8,
      oktober: 9,
      november: 10,
      dezember: 11,
    }
    const [, day, month, year, time] = germanMatch
    const hours = time ? time.split(':')[0] : 0
    const minutes = time ? time.split(':')[1] || 0 : 0
    const seconds = time && time.includes(':') ? time.split(':')[2] || 0 : 0
    return new Date(
      year,
      germanMonths[month.toLowerCase()],
      day,
      hours,
      minutes,
      seconds,
    )
  }

  const englishMatch = dateStr.match(
    /(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\s*,?\s*(\d{1,2}:\d{2}(?::\d{2})?)?/i,
  )
  if (englishMatch) {
    const months = {
      january: 0,
      february: 1,
      march: 2,
      april: 3,
      may: 4,
      june: 5,
      july: 6,
      august: 7,
      september: 8,
      october: 9,
      november: 10,
      december: 11,
    }
    const [, day, month, year, time] = englishMatch
    const hours = time ? time.split(':')[0] : 0
    const minutes = time ? time.split(':')[1] || 0 : 0
    const seconds = time && time.includes(':') ? time.split(':')[2] || 0 : 0
    return new Date(
      year,
      months[month.toLowerCase()],
      day,
      hours,
      minutes,
      seconds,
    )
  }

  return null
}

function parseGermanOutlookReply(text) {
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
