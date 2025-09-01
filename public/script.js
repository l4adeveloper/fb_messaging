// Global variables
let currentUser = null
let selectedPage = null

// Login with Facebook
function loginWithFacebook() {
  window.location.href = "/auth/facebook"
}

document.addEventListener("DOMContentLoaded", () => {
  // Check for error in URL parameters
  const urlParams = new URLSearchParams(window.location.search)
  const error = urlParams.get("error")

  if (error) {
    showError(decodeURIComponent(error))
  }
})

function showError(message) {
  const errorElement = document.getElementById("error-message")
  if (errorElement) {
    errorElement.textContent = message
    errorElement.style.display = "block"

    // Auto-hide after 10 seconds
    setTimeout(() => {
      errorElement.style.display = "none"
    }, 10000)
  }
}

// Load user data on dashboard
async function loadUserData() {
  try {
    // First, try to refresh token if needed
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
        <h2>Xin chào, ${currentUser.name}</h2>
        <p>Email: ${currentUser.email}</p>
        <p class="permissions">${permissionsText}</p>
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
            <div class="page-item" onclick="selectPage('${page.id}')">
                <h4>${page.name}</h4>
                <p>ID: ${page.id} | Loại: ${page.category}</p>
            </div>
        `,
      )
      .join("")
  }
}

// Select a page
async function selectPage(pageId) {
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

      // Update UI
      document.querySelectorAll(".page-item").forEach((item) => {
        item.classList.remove("selected")
      })
      event.target.closest(".page-item").classList.add("selected")

      // Show messaging section
      const messagingSection = document.getElementById("messaging-section")
      if (messagingSection) {
        messagingSection.classList.add("active")
      }

      showNotification(`Đã chọn trang: ${selectedPage.name}`, "success")
    } else {
      showNotification("Không thể chọn trang", "error")
    }
  } catch (error) {
    console.error("Error selecting page:", error)
    showNotification("Lỗi khi chọn trang", "error")
  }
}

// Send message
async function sendMessage() {
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
async function sendOTN() {
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
    } else {
      const error = await response.json()
      showNotification(`Lỗi: ${error.error}`, "error")
    }
  } catch (error) {
    console.error("Error sending OTN:", error)
    showNotification("Lỗi khi gửi OTN", "error")
  }
}

// Logout
async function logout() {
  try {
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

// Show notification
function showNotification(message, type = "info") {
  // Create notification element
  const notification = document.createElement("div")
  notification.className = `notification ${type}`
  notification.textContent = message

  // Add styles
  notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        max-width: 300px;
        word-wrap: break-word;
        ${type === "success" ? "background: #28a745;" : ""}
        ${type === "error" ? "background: #dc3545;" : ""}
        ${type === "info" ? "background: #17a2b8;" : ""}
    `

  document.body.appendChild(notification)

  // Remove after 5 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification)
    }
  }, 5000)
}

// Initialize dashboard if on dashboard page
if (window.location.pathname === "/dashboard") {
  document.addEventListener("DOMContentLoaded", loadUserData)
}
