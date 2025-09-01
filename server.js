const express = require("express")
const bodyParser = require("body-parser")
const cors = require("cors")
const session = require("express-session")
const crypto = require("crypto")
const axios = require("axios")
const path = require("path")
require("dotenv").config()

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(express.static("public"))

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true in production with HTTPS
  }),
)

// Store for user data and page tokens
const userStore = new Map()
const pageStore = new Map()
const messageStore = new Map() // pageId -> messages array
const conversationStore = new Map() // pageId -> conversations map (senderId -> conversation)

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

// Facebook OAuth routes
app.get("/auth/facebook", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex")
  req.session.state = state

  const fbAuthUrl =
    `https://www.facebook.com/v18.0/dialog/oauth?` +
    `client_id=${process.env.FACEBOOK_APP_ID}&` +
    `redirect_uri=${encodeURIComponent(process.env.FACEBOOK_REDIRECT_URI)}&` +
    `scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_read_user_content,pages_messaging,pages_messaging_subscriptions&` +
    `response_type=code&` +
    `state=${state}&` +
    `auth_type=rerequest`

  res.redirect(fbAuthUrl)
})

app.get("/auth/facebook/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query

  if (error) {
    console.error("OAuth error:", error, error_description)
    return res.redirect(`/?error=${encodeURIComponent(error_description || error)}`)
  }

  if (!code || state !== req.session.state) {
    return res.redirect("/?error=Invalid request or CSRF token mismatch")
  }

  try {
    // Exchange code for access token
    const tokenResponse = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
        code: code,
      },
    })

    const shortLivedToken = tokenResponse.data.access_token

    const longLivedTokenResponse = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    })

    const userAccessToken = longLivedTokenResponse.data.access_token

    const tokenInfoResponse = await axios.get(`https://graph.facebook.com/v18.0/me/permissions`, {
      params: {
        access_token: userAccessToken,
      },
    })

    const permissions = tokenInfoResponse.data.data
    const requiredPermissions = ["pages_show_list", "pages_messaging", "pages_read_engagement"]
    const grantedPermissions = permissions.filter((p) => p.status === "granted").map((p) => p.permission)

    // Check if all required permissions are granted
    const missingPermissions = requiredPermissions.filter((p) => !grantedPermissions.includes(p))
    if (missingPermissions.length > 0) {
      console.error("Missing permissions:", missingPermissions)
      return res.redirect(`/?error=Missing required permissions: ${missingPermissions.join(", ")}`)
    }

    // Get user info
    const userResponse = await axios.get(`https://graph.facebook.com/v18.0/me`, {
      params: {
        access_token: userAccessToken,
        fields: "id,name,email",
      },
    })

    // Get user's pages with enhanced fields
    const pagesResponse = await axios.get(`https://graph.facebook.com/v18.0/me/accounts`, {
      params: {
        access_token: userAccessToken,
        fields: "id,name,access_token,category,tasks,picture",
      },
    })

    const messagingPages = pagesResponse.data.data.filter((page) => page.tasks && page.tasks.includes("MESSAGING"))

    if (messagingPages.length === 0) {
      return res.redirect(
        "/?error=No pages with messaging permissions found. Please ensure your pages have messaging enabled.",
      )
    }

    for (const page of messagingPages) {
      try {
        await axios.post(
          `https://graph.facebook.com/v18.0/${page.id}/subscribed_apps`,
          {
            subscribed_fields: "messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads",
          },
          {
            params: {
              access_token: page.access_token,
            },
          },
        )
        console.log(`Successfully subscribed page ${page.name} to webhooks`)
      } catch (webhookError) {
        console.error(
          `Failed to subscribe page ${page.name} to webhooks:`,
          webhookError.response?.data || webhookError.message,
        )
      }
    }

    // Store user data
    const userData = {
      id: userResponse.data.id,
      name: userResponse.data.name,
      email: userResponse.data.email,
      accessToken: userAccessToken,
      pages: messagingPages,
      permissions: grantedPermissions,
      tokenExpiry: Date.now() + longLivedTokenResponse.data.expires_in * 1000, // Convert to timestamp
    }

    userStore.set(req.session.id, userData)
    req.session.userId = userResponse.data.id

    res.redirect("/dashboard")
  } catch (error) {
    console.error("OAuth error:", error.response?.data || error.message)
    res.redirect(`/?error=${encodeURIComponent("Authentication failed. Please try again.")}`)
  }
})

// Dashboard route
app.get("/dashboard", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/")
  }
  res.sendFile(path.join(__dirname, "public", "dashboard.html"))
})

// API Routes
app.get("/api/user", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const userData = userStore.get(req.session.id)
  if (!userData) {
    return res.status(404).json({ error: "User not found" })
  }

  res.json({
    id: userData.id,
    name: userData.name,
    email: userData.email,
    pages: userData.pages,
    permissions: userData.permissions,
  })
})

app.post("/api/select-page", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const { pageId } = req.body
  const userData = userStore.get(req.session.id)

  if (!userData) {
    return res.status(404).json({ error: "User not found" })
  }

  const selectedPage = userData.pages.find((page) => page.id === pageId)
  if (!selectedPage) {
    return res.status(404).json({ error: "Page not found" })
  }

  // Store selected page
  pageStore.set(req.session.id, selectedPage)
  req.session.selectedPageId = pageId

  res.json({ success: true, page: selectedPage })
})

// Webhook verification
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN

  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WEBHOOK_VERIFIED")
      res.status(200).send(challenge)
    } else {
      res.sendStatus(403)
    }
  }
})

// Webhook for receiving messages
app.post("/webhook", (req, res) => {
  const body = req.body

  const signature = req.get("X-Hub-Signature-256")
  if (signature && process.env.FACEBOOK_APP_SECRET) {
    const expectedSignature = crypto
      .createHmac("sha256", process.env.FACEBOOK_APP_SECRET)
      .update(JSON.stringify(body))
      .digest("hex")

    if (`sha256=${expectedSignature}` !== signature) {
      console.error("Invalid webhook signature")
      return res.sendStatus(403)
    }
  }

  if (body.object === "page") {
    body.entry.forEach((entry) => {
      if (entry.messaging) {
        entry.messaging.forEach((webhookEvent) => {
          console.log("Received webhook event:", webhookEvent)

          if (webhookEvent.message) {
            handleMessage(webhookEvent, entry.id)
          } else if (webhookEvent.postback) {
            handlePostback(webhookEvent, entry.id)
          } else if (webhookEvent.delivery) {
            handleDelivery(webhookEvent, entry.id)
          } else if (webhookEvent.read) {
            handleRead(webhookEvent, entry.id)
          } else if (webhookEvent.optin) {
            handleOptin(webhookEvent, entry.id)
          }
        })
      }
    })

    res.status(200).send("EVENT_RECEIVED")
  } else {
    res.sendStatus(404)
  }
})

// Message handling functions
async function handleMessage(event, pageId) {
  const senderId = event.sender.id
  const recipientId = event.recipient.id
  const message = event.message
  const timestamp = event.timestamp

  console.log(`Received message from ${senderId} to page ${pageId}: ${message.text || "[non-text message]"}`)

  try {
    const senderInfo = await getSenderInfo(senderId, pageId)

    const messageObj = {
      id: message.mid || `msg_${Date.now()}_${Math.random()}`,
      senderId,
      recipientId,
      pageId,
      timestamp,
      type: "received",
      text: message.text || null,
      attachments: message.attachments || null,
      quickReply: message.quick_reply || null,
      isEcho: message.is_echo || false,
      senderInfo,
      createdAt: new Date(timestamp).toISOString(),
    }

    storeMessage(pageId, messageObj)

    updateConversation(pageId, senderId, messageObj, senderInfo)

    console.log(`Message stored successfully for page ${pageId}`)
  } catch (error) {
    console.error("Error handling message:", error)
  }
}

async function handlePostback(event, pageId) {
  const senderId = event.sender.id
  const postback = event.postback
  const timestamp = event.timestamp

  console.log(`Received postback from ${senderId} to page ${pageId}: ${postback.payload}`)

  try {
    const senderInfo = await getSenderInfo(senderId, pageId)

    const messageObj = {
      id: `postback_${Date.now()}_${Math.random()}`,
      senderId,
      recipientId: event.recipient.id,
      pageId,
      timestamp,
      type: "postback",
      payload: postback.payload,
      title: postback.title,
      referral: postback.referral || null,
      senderInfo,
      createdAt: new Date(timestamp).toISOString(),
    }

    storeMessage(pageId, messageObj)

    updateConversation(pageId, senderId, messageObj, senderInfo)

    console.log(`Postback stored successfully for page ${pageId}`)
  } catch (error) {
    console.error("Error handling postback:", error)
  }
}

async function handleDelivery(event, pageId) {
  const senderId = event.sender.id
  const delivery = event.delivery

  console.log(`Message delivery confirmed for page ${pageId}, sender ${senderId}`)

  updateMessageDeliveryStatus(pageId, delivery.mids, "delivered")
}

async function handleRead(event, pageId) {
  const senderId = event.sender.id
  const read = event.read

  console.log(`Messages read by ${senderId} on page ${pageId} until ${read.watermark}`)

  updateMessageReadStatus(pageId, senderId, read.watermark)
}

async function handleOptin(event, pageId) {
  const senderId = event.sender.id
  const optin = event.optin

  console.log(`User ${senderId} opted in for notifications on page ${pageId}`)

  storeOTNToken(pageId, senderId, optin.one_time_notif_token)
}

async function getSenderInfo(senderId, pageId) {
  try {
    let pageAccessToken = null
    for (const [sessionId, page] of pageStore.entries()) {
      if (page.id === pageId) {
        pageAccessToken = page.access_token
        break
      }
    }

    if (!pageAccessToken) {
      for (const [sessionId, userData] of userStore.entries()) {
        const page = userData.pages.find((p) => p.id === pageId)
        if (page) {
          pageAccessToken = page.access_token
          break
        }
      }
    }

    if (!pageAccessToken) {
      console.warn(`No access token found for page ${pageId}`)
      return { id: senderId, name: "Unknown User" }
    }

    const response = await axios.get(`https://graph.facebook.com/v18.0/${senderId}`, {
      params: {
        fields: "first_name,last_name,profile_pic",
        access_token: pageAccessToken,
      },
    })

    return {
      id: senderId,
      firstName: response.data.first_name,
      lastName: response.data.last_name,
      name: `${response.data.first_name} ${response.data.last_name}`,
      profilePic: response.data.profile_pic,
    }
  } catch (error) {
    console.error("Error getting sender info:", error.response?.data || error.message)
    return { id: senderId, name: "Unknown User" }
  }
}

function storeMessage(pageId, messageObj) {
  if (!messageStore.has(pageId)) {
    messageStore.set(pageId, [])
  }

  const messages = messageStore.get(pageId)
  messages.push(messageObj)

  if (messages.length > 1000) {
    messages.splice(0, messages.length - 1000)
  }

  messageStore.set(pageId, messages)
}

function updateConversation(pageId, senderId, messageObj, senderInfo) {
  if (!conversationStore.has(pageId)) {
    conversationStore.set(pageId, new Map())
  }

  const conversations = conversationStore.get(pageId)

  if (!conversations.has(senderId)) {
    conversations.set(senderId, {
      senderId,
      senderInfo,
      lastMessage: messageObj,
      lastActivity: messageObj.timestamp,
      unreadCount: messageObj.type === "received" ? 1 : 0,
      messages: [],
    })
  } else {
    const conversation = conversations.get(senderId)
    conversation.lastMessage = messageObj
    conversation.lastActivity = messageObj.timestamp
    conversation.senderInfo = senderInfo

    if (messageObj.type === "received") {
      conversation.unreadCount += 1
    }
  }
}

function updateMessageDeliveryStatus(pageId, messageIds, status) {
  if (!messageStore.has(pageId)) return

  const messages = messageStore.get(pageId)
  messages.forEach((msg) => {
    if (messageIds.includes(msg.id)) {
      msg.deliveryStatus = status
    }
  })
}

function updateMessageReadStatus(pageId, senderId, watermark) {
  if (!messageStore.has(pageId)) return

  const messages = messageStore.get(pageId)
  messages.forEach((msg) => {
    if (msg.senderId === senderId && msg.timestamp <= watermark) {
      msg.readStatus = "read"
    }
  })

  if (conversationStore.has(pageId)) {
    const conversations = conversationStore.get(pageId)
    if (conversations.has(senderId)) {
      const conversation = conversations.get(senderId)
      conversation.unreadCount = 0
    }
  }
}

function storeOTNToken(pageId, senderId, token) {
  const key = `${pageId}_${senderId}`
  console.log(`Stored OTN token for ${key}: ${token}`)
}

app.get("/api/messages/:pageId", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const { pageId } = req.params
  const { limit = 50, offset = 0 } = req.query

  const userData = userStore.get(req.session.id)
  if (!userData || !userData.pages.find((p) => p.id === pageId)) {
    return res.status(403).json({ error: "Access denied to this page" })
  }

  const messages = messageStore.get(pageId) || []
  const paginatedMessages = messages.slice(-limit - offset, messages.length - offset).reverse()

  res.json({
    messages: paginatedMessages,
    total: messages.length,
    hasMore: messages.length > limit + offset,
  })
})

app.get("/api/conversations/:pageId", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const { pageId } = req.params

  const userData = userStore.get(req.session.id)
  if (!userData || !userData.pages.find((p) => p.id === pageId)) {
    return res.status(403).json({ error: "Access denied to this page" })
  }

  const conversations = conversationStore.get(pageId) || new Map()
  const conversationList = Array.from(conversations.values()).sort((a, b) => b.lastActivity - a.lastActivity)

  res.json({ conversations: conversationList })
})

app.post("/api/mark-read/:pageId/:senderId", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const { pageId, senderId } = req.params

  const userData = userStore.get(req.session.id)
  if (!userData || !userData.pages.find((p) => p.id === pageId)) {
    return res.status(403).json({ error: "Access denied to this page" })
  }

  if (conversationStore.has(pageId)) {
    const conversations = conversationStore.get(pageId)
    if (conversations.has(senderId)) {
      const conversation = conversations.get(senderId)
      conversation.unreadCount = 0
    }
  }

  res.json({ success: true })
})

app.post("/api/send-message", async (req, res) => {
  if (!req.session.userId || !req.session.selectedPageId) {
    return res.status(401).json({ error: "Not authenticated or no page selected" })
  }

  const { recipientId, message } = req.body
  const selectedPage = pageStore.get(req.session.id)

  if (!selectedPage) {
    return res.status(404).json({ error: "Selected page not found" })
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text: message },
      },
      {
        params: {
          access_token: selectedPage.access_token,
        },
      },
    )

    res.json({ success: true, messageId: response.data.message_id })
  } catch (error) {
    console.error("Send message error:", error.response?.data || error.message)
    res.status(500).json({ error: "Failed to send message" })
  }
})

app.post("/api/send-otn", async (req, res) => {
  if (!req.session.userId || !req.session.selectedPageId) {
    return res.status(401).json({ error: "Not authenticated or no page selected" })
  }

  const { recipientId, otnToken, message } = req.body
  const selectedPage = pageStore.get(req.session.id)

  if (!selectedPage) {
    return res.status(404).json({ error: "Selected page not found" })
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/me/messages`,
      {
        recipient: { one_time_notif_token: otnToken },
        message: { text: message },
      },
      {
        params: {
          access_token: selectedPage.access_token,
        },
      },
    )

    res.json({ success: true, messageId: response.data.message_id })
  } catch (error) {
    console.error("Send OTN error:", error.response?.data || error.message)
    res.status(500).json({ error: "Failed to send OTN" })
  }
})

app.post("/api/logout", (req, res) => {
  userStore.delete(req.session.id)
  pageStore.delete(req.session.id)
  req.session.destroy()
  res.json({ success: true })
})

app.post("/api/refresh-token", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" })
  }

  const userData = userStore.get(req.session.id)
  if (!userData) {
    return res.status(404).json({ error: "User not found" })
  }

  const oneDayFromNow = Date.now() + 24 * 60 * 60 * 1000
  if (userData.tokenExpiry > oneDayFromNow) {
    return res.json({ success: true, message: "Token is still valid" })
  }

  try {
    const refreshResponse = await axios.get(`https://graph.facebook.com/v18.0/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: process.env.FACEBOOK_APP_ID,
        client_secret: process.env.FACEBOOK_APP_SECRET,
        fb_exchange_token: userData.accessToken,
      },
    })

    userData.accessToken = refreshResponse.data.access_token
    userData.tokenExpiry = Date.now() + refreshResponse.data.expires_in * 1000
    userStore.set(req.session.id, userData)

    res.json({ success: true, message: "Token refreshed successfully" })
  } catch (error) {
    console.error("Token refresh error:", error.response?.data || error.message)
    res.status(500).json({ error: "Failed to refresh token" })
  }
})

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
  console.log(`Visit http://localhost:${PORT} to start`)
})
