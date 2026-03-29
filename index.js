'use strict'
const axios = require('axios')
const simpleParser = require('mailparser').simpleParser
const stringify = require('string.ify')
const DSN = require('haraka-dsn')
const EmailReplyParser = require('email-reply-parser').default
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

      const text_body = mail.text
        ? mail.text
        : mail.html.replace(/<[^>]*>/g, '')
      const replayParser = new EmailReplyParser()

      const forwardResult = new EmailForwardParser().read(
        text_body,
        mail.subject,
      )

      if (forwardResult.forwarded) {
        subject = forwardResult.email.subject || mail.subject
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
        from: mail.from?.value?.map((item) => item.address)[0] || [],
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
        timestamp: new Date(),
        references: mail.references || [],
      }

      _email.in_reply_to = (!!mail.inReplyTo && mail.inReplyTo.length > 0) ? mail.inReplyTo : false

      plugin.loginfo('Processed E-Mail: ' + stringify(_email))

      axios
        .post(url, { payload: _email }, { timeout: 10000 })
        .then(() => next(OK))
        .catch((err) => {
          plugin.logerror(`Dropbox post failed: ${err.message}`)
          next(DENYSOFT, 'Dropbox webhook temporarily unavailable')
        })
    } else {
      next(DENY, DSN.no_such_user())
    }
  })
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
