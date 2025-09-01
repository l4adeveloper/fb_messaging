// Global variables
let currentUser = null
let selectedPage = null
let currentConversation = null
let messagesPollingInterval = null

// Initialize dashboard
document.addEventListener("DOMContentLoaded", () => {
  loadUserData()
})

// Load user data
async function loadUserData() {
  showLoading(true)
  try {
    await fetch("/api/refresh-token", { method: "POST" })

    const response = await fetch("/api/user")
    if (response.ok) {
      currentUser = await response.json()
      displayUserInfo()
      displayPages()
    } else {
      window.location.href = "/"
    }
  } catch (error) {
    console.error("Error loading user data:", error)
    window.location.href = "/"
  } finally {
    showLoading(false)
  }
}

// Display user information
function displayUserInfo() {
  const userInfoElement = document.getElementById("user-info")
  if (userInfoElement && currentUser) {
    const permissionsText = currentUser.permissions
      ? `Quyền: ${currentUser.permissions.join(", ")}`
      : "Quyền: Đang tải..."

    userInfoElement.innerHTML = `
      <div class="user-details">
        <h2>${currentUser.name}</h2>
        <p>${currentUser.email}</p>
      </div>
      <button class="logout-btn" onclick="logout()">Đăng xuất</button>
    `
  }
}

// Display user's pages
function displayPages() {
  const pageListElement = document.getElementById("page-list")
  if (pageListElement && currentUser && currentUser.pages) {
    pageListElement.innerHTML = currentUser.pages
      .map(
        (page) => `
            <div class="page-item" data-page-id="${page.id}" onclick="selectPage('${page.id}')">
                <div class="page-avatar">
                    <img src="/facebook-page-icon.png" alt="${page.name}" />
                </div>
                <div class="page-info">
                    <h4>${page.name}</h4>
                    <p class="page-category">${page.category}</p>
                    <p class="page-id">ID: ${page.id}</p>
                </div>
                <div class="page-status">
                    <span class="status-dot"></span>
                </div>
            </div>
        `,
      )
      .join("")
  }
}

// Select a page
async function selectPage(pageId) {
  showLoading(true)
  try {
    const response = await fetch("/api/select-page", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pageId }),
    })

    if (response.ok) {
      const result = await response.json()
      selectedPage = result.page

      // Update UI - remove selected class from all pages
      document.querySelectorAll(".page-item").forEach((item) => {
        item.classList.remove("selected")
      })

      // Add selected class to clicked page using data attribute
      const selectedPageElement = document.querySelector(`[data-page-id="${pageId}"]`)
      if (selectedPageElement) {
        selectedPageElement.classList.add("selected")
      }

      // Show conversations section
      const conversationsSection = document.getElementById("conversations-section")
      if (conversationsSection) {
        conversationsSection.style.display = "block"
      }

      // Show messaging section
      const messagingSection = document.getElementById("messaging-section")
      if (messagingSection) {
        messagingSection.classList.add("active")
      }

      // Hide welcome message
      const welcomeMessage = document.getElementById("welcome-message")
      if (welcomeMessage) {
        welcomeMessage.style.display = "none"
      }

      // Load conversations
      await loadConversations()

      showNotification(`Đã chọn trang: ${selectedPage.name}`, "success")
    } else {
      const errorData = await response.json()
      showNotification(`Không thể chọn trang: ${errorData.error || "Lỗi không xác định"}`, "error")
    }
  } catch (error) {
    console.error("Error selecting page:", error)
    showNotification("Lỗi kết nối khi chọn trang", "error")
  } finally {
    showLoading(false)
  }
}

// Load conversations
async function loadConversations() {
  if (!selectedPage) return

  try {
    const response = await fetch(`/api/conversations/${selectedPage.id}`)
    if (response.ok) {
      const result = await response.json()
      displayConversations(result.conversations)
    }
  } catch (error) {
    console.error("Error loading conversations:", error)
  }
}

// Display conversations
function displayConversations(conversations) {
  const conversationList = document.getElementById("conversation-list")
  if (!conversationList) return

  if (conversations.length === 0) {
    conversationList.innerHTML = '<p class="no-conversations">Chưa có cuộc hội thoại nào</p>'
    return
  }

  conversationList.innerHTML = conversations
    .map((conversation) => {
      const lastMessageText =
        conversation.lastMessage?.text || conversation.lastMessage?.payload || "[Tin nhắn không có văn bản]"
      const unreadClass = conversation.unreadCount > 0 ? "unread" : ""
      const lastMessageTime = conversation.lastMessage?.createdAt
        ? new Date(conversation.lastMessage.createdAt).toLocaleTimeString("vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : ""

      return `
        <div class="conversation-item ${unreadClass}" data-sender-id="${conversation.senderId}" onclick="selectConversation('${conversation.senderId}')">
          <img src="${conversation.senderInfo?.profilePic || "/diverse-user-avatars.png"}" 
               alt="${conversation.senderInfo?.name || "User"}" 
               class="user-avatar">
          <div class="conversation-info">
            <div class="conversation-header">
              <div class="conversation-name">${conversation.senderInfo?.name || "Unknown User"}</div>
              ${lastMessageTime ? `<div class="conversation-time">${lastMessageTime}</div>` : ""}
            </div>
            <div class="conversation-preview">${lastMessageText}</div>
          </div>
          ${conversation.unreadCount > 0 ? `<div class="unread-badge">${conversation.unreadCount}</div>` : ""}
        </div>
      `
    })
    .join("")
}

// Select conversation
async function selectConversation(senderId) {
  currentConversation = senderId

  // Update UI
  document.querySelectorAll(".conversation-item").forEach((item) => {
    item.classList.remove("active")
  })

  // Find the clicked conversation item
  const clickedConversationItem = document.querySelector(`[data-sender-id="${senderId}"]`)
  if (clickedConversationItem) {
    clickedConversationItem.classList.add("active")
  }

  // Mark as read
  await markConversationAsRead(senderId)

  // Show chat interface
  const chatInterface = document.getElementById("chat-interface")
  const welcomeMessage = document.getElementById("welcome-message")
  const messagingSection = document.getElementById("messaging-section")

  if (chatInterface && welcomeMessage && messagingSection) {
    chatInterface.style.display = "flex"
    welcomeMessage.style.display = "none"
    messagingSection.style.display = "none"
  }

  // Load messages
  await loadMessages()

  // Start polling for new messages
  startMessagesPolling()
}

// Load messages
async function loadMessages() {
  if (!selectedPage) return

  try {
    const response = await fetch(`/api/messages/${selectedPage.id}?limit=50`)
    if (response.ok) {
      const result = await response.json()
      displayMessages(
        result.messages.filter(
          (msg) => msg.senderId === currentConversation || msg.recipientId === currentConversation,
        ),
      )
    }
  } catch (error) {
    console.error("Error loading messages:", error)
  }
}

// Display messages
function displayMessages(messages) {
  const messagesList = document.getElementById("messages-list")
  if (!messagesList) return

  messagesList.innerHTML = messages
    .map((message) => {
      const isReceived = message.type === "received"
      const messageClass = isReceived ? "received" : "sent"
      const time = new Date(message.createdAt).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      })

      return `
        <div class="message ${messageClass}">
          ${
            isReceived
              ? `<img src="${message.senderInfo?.profilePic || "/placeholder.svg?height=32&width=32"}" 
                                alt="${message.senderInfo?.name || "User"}" 
                                class="user-avatar" style="width: 32px; height: 32px;">`
              : ""
          }
          <div class="message-bubble">
            <div class="message-text">${message.text || message.payload || "[Tin nhắn không có văn bản]"}</div>
            <div class="message-time">${time}</div>
          </div>
        </div>
      `
    })
    .join("")

  // Scroll to bottom
  messagesList.scrollTop = messagesList.scrollHeight
}

// Mark conversation as read
async function markConversationAsRead(senderId) {
  if (!selectedPage) return

  try {
    await fetch(`/api/mark-read/${selectedPage.id}/${senderId}`, {
      method: "POST",
    })

    // Update conversation list
    await loadConversations()
  } catch (error) {
    console.error("Error marking conversation as read:", error)
  }
}

// Start polling for new messages
function startMessagesPolling() {
  // Clear existing interval
  if (messagesPollingInterval) {
    clearInterval(messagesPollingInterval)
  }

  // Poll every 3 seconds
  messagesPollingInterval = setInterval(async () => {
    if (currentConversation && selectedPage) {
      await loadMessages()
      await loadConversations()
    }
  }, 3000)
}

// Stop polling
function stopMessagesPolling() {
  if (messagesPollingInterval) {
    clearInterval(messagesPollingInterval)
    messagesPollingInterval = null
  }
}

// Handle message input key press
function handleMessageKeyPress(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    sendQuickMessage()
  }
}

// Send quick message
async function sendQuickMessage() {
  const messageInput = document.getElementById("message-input")
  const message = messageInput.value.trim()

  if (!message || !currentConversation || !selectedPage) {
    return
  }

  try {
    const response = await fetch("/api/send-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipientId: currentConversation,
        message: message,
      }),
    })

    if (response.ok) {
      messageInput.value = ""
      await loadMessages()
      showNotification("Tin nhắn đã được gửi!", "success")
    } else {
      const error = await response.json()
      showNotification(`Lỗi: ${error.error}`, "error")
    }
  } catch (error) {
    console.error("Error sending message:", error)
    showNotification("Lỗi khi gửi tin nhắn", "error")
  }
}

// Send message from form
async function sendMessage(event) {
  event.preventDefault()

  const recipientId = document.getElementById("recipient-id").value
  const message = document.getElementById("message-text").value

  if (!recipientId || !message) {
    showNotification("Vui lòng nhập đầy đủ thông tin", "error")
    return
  }

  if (!selectedPage) {
    showNotification("Vui lòng chọn trang trước", "error")
    return
  }

  try {
    const response = await fetch("/api/send-message", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipientId,
        message,
      }),
    })

    if (response.ok) {
      const result = await response.json()
      showNotification("Tin nhắn đã được gửi thành công!", "success")
      document.getElementById("message-text").value = ""
      document.getElementById("recipient-id").value = ""
    } else {
      const error = await response.json()
      showNotification(`Lỗi: ${error.error}`, "error")
    }
  } catch (error) {
    console.error("Error sending message:", error)
    showNotification("Lỗi khi gửi tin nhắn", "error")
  }
}

// Send OTN
async function sendOTN(event) {
  event.preventDefault()

  const recipientId = document.getElementById("otn-recipient-id").value
  const otnToken = document.getElementById("otn-token").value
  const message = document.getElementById("otn-message").value

  if (!recipientId || !otnToken || !message) {
    showNotification("Vui lòng nhập đầy đủ thông tin OTN", "error")
    return
  }

  if (!selectedPage) {
    showNotification("Vui lòng chọn trang trước", "error")
    return
  }

  try {
    const response = await fetch("/api/send-otn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipientId,
        otnToken,
        message,
      }),
    })

    if (response.ok) {
      const result = await response.json()
      showNotification("OTN đã được gửi thành công!", "success")
      document.getElementById("otn-message").value = ""
      document.getElementById("otn-token").value = ""
      document.getElementById("otn-recipient-id").value = ""
    } else {
      const error = await response.json()
      showNotification(`Lỗi: ${error.error}`, "error")
    }
  } catch (error) {
    console.error("Error sending OTN:", error)
    showNotification("Lỗi khi gửi OTN", "error")
  }
}

// Refresh messages
async function refreshMessages() {
  if (currentConversation) {
    await loadMessages()
    await loadConversations()
    showNotification("Đã làm mới tin nhắn", "success")
  }
}

// Logout
async function logout() {
  try {
    stopMessagesPolling()
    const response = await fetch("/api/logout", {
      method: "POST",
    })

    if (response.ok) {
      window.location.href = "/"
    }
  } catch (error) {
    console.error("Error logging out:", error)
    window.location.href = "/"
  }
}

// Show loading overlay
function showLoading(show) {
  const loadingOverlay = document.getElementById("loading-overlay")
  if (loadingOverlay) {
    loadingOverlay.style.display = show ? "flex" : "none"
  }
}

// Show notification
function showNotification(message, type = "info") {
  const container = document.getElementById("notification-container") || document.body

  const notification = document.createElement("div")
  notification.className = `notification ${type}`
  notification.textContent = message

  notification.style.cssText = `
    padding: 12px 16px;
    border-radius: 8px;
    color: white;
    font-weight: 500;
    max-width: 320px;
    word-wrap: break-word;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateX(100%);
    transition: transform 0.3s ease;
    ${type === "success" ? "background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);" : ""}
    ${type === "error" ? "background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);" : ""}
    ${type === "info" ? "background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%);" : ""}
  `

  if (container.id === "notification-container") {
    container.appendChild(notification)
  } else {
    notification.style.position = "fixed"
    notification.style.top = "20px"
    notification.style.right = "20px"
    notification.style.zIndex = "10000"
    container.appendChild(notification)
  }

  // Animate in
  setTimeout(() => {
    notification.style.transform = "translateX(0)"
  }, 100)

  // Animate out and remove
  setTimeout(() => {
    notification.style.transform = "translateX(100%)"
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification)
      }
    }, 300)
  }, 4700)
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  stopMessagesPolling()
})

function autoResizeTextarea(textarea) {
  textarea.style.height = "auto"
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px"
}

function toggleChatInfo() {
  // Placeholder for future chat info panel
  showNotification("Tính năng thông tin cuộc hội thoại sẽ được thêm sau", "info")
}
