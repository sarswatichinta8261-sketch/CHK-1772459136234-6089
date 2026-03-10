// Global variables
let currentUser = null;
let socket = null;
let grievances = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

function initializeApp() {
    // Initialize Socket.IO
    socket = io();
    
    // Check for existing session
    const token = localStorage.getItem('token');
    if (token) {
        verifyToken(token);
    } else {
        showLoginModal();
    }
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial data
    loadStatistics();
}

function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    
    // Register form
    document.getElementById('registerForm').addEventListener('submit', handleRegister);
    
    // Grievance form
    document.getElementById('grievanceForm').addEventListener('submit', handleGrievanceSubmit);
    
    // Socket.IO events
    socket.on('new_grievance', function(data) {
        showNotification('New grievance received', 'info');
        if (currentUser && currentUser.role !== 'citizen') {
            loadDashboardGrievances();
        }
    });
    
    socket.on('status_update', function(data) {
        showNotification(`Grievance status updated to: ${data.status}`, 'success');
        updateGrievanceStatus(data.grievanceId, data.status);
    });
    
    socket.on('escalation', function(data) {
        showNotification(`Grievance escalated to level ${data.escalationLevel}`, 'warning');
        if (currentUser && currentUser.role === 'admin') {
            loadDashboardGrievances();
        }
    });
}

// Authentication functions
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            currentUser = data.user;
            updateUserDisplay();
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            showNotification('Login successful', 'success');
            loadDashboardGrievances();
        } else {
            showNotification(data.message || 'Login failed', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    
    const username = document.getElementById('regUsername').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('regRole').value;
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, email, password, role })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            localStorage.setItem('token', data.token);
            currentUser = data.user;
            updateUserDisplay();
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            showNotification('Registration successful', 'success');
            loadDashboardGrievances();
        } else {
            showNotification(data.message || 'Registration failed', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}

async function verifyToken(token) {
    try {
        const response = await fetch('/api/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            updateUserDisplay();
            loadDashboardGrievances();
        } else {
            localStorage.removeItem('token');
            showLoginModal();
        }
    } catch (error) {
        localStorage.removeItem('token');
        showLoginModal();
    }
}

function logout() {
    localStorage.removeItem('token');
    currentUser = null;
    updateUserDisplay();
    showLoginModal();
    showSection('home');
}

function showLoginModal() {
    const modal = new bootstrap.Modal(document.getElementById('loginModal'));
    modal.show();
}

function updateUserDisplay() {
    const userDisplay = document.getElementById('userDisplay');
    if (currentUser) {
        userDisplay.textContent = currentUser.username;
    } else {
        userDisplay.textContent = 'Guest';
    }
}

// Section navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.style.display = 'none';
    });
    
    // Show selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.style.display = 'block';
        selectedSection.classList.add('fade-in');
    }
    
    // Load section-specific data
    switch(sectionId) {
        case 'dashboard':
            loadDashboardGrievances();
            loadDashboardCharts();
            break;
        case 'track':
            loadUserGrievances();
            break;
        case 'reports':
            generateReport();
            break;
    }
}

// Grievance functions
async function handleGrievanceSubmit(e) {
    e.preventDefault();
    
    if (!currentUser) {
        showNotification('Please login to submit a grievance', 'warning');
        showLoginModal();
        return;
    }
    
    const formData = new FormData();
    formData.append('title', document.getElementById('title').value);
    formData.append('category', document.getElementById('category').value);
    formData.append('subcategory', document.getElementById('subcategory').value);
    formData.append('priority', document.getElementById('priority').value);
    formData.append('department', document.getElementById('department').value);
    formData.append('location', document.getElementById('location').value);
    formData.append('description', document.getElementById('description').value);
    
    // Handle file attachments
    const attachments = document.getElementById('attachments').files;
    for (let i = 0; i < attachments.length; i++) {
        formData.append('attachments', attachments[i]);
    }
    
    try {
        const response = await fetch('/api/grievances', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Grievance submitted successfully', 'success');
            document.getElementById('grievanceForm').reset();
            showSection('track');
            loadUserGrievances();
        } else {
            showNotification(data.message || 'Failed to submit grievance', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}

async function loadUserGrievances() {
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/grievances', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            grievances = data.grievances;
            displayGrievances(grievances);
        } else {
            showNotification('Failed to load grievances', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}

function displayGrievances(grievanceList) {
    const container = document.getElementById('grievanceList');
    
    if (grievanceList.length === 0) {
        container.innerHTML = '<div class="col-12 text-center"><p class="text-muted">No grievances found</p></div>';
        return;
    }
    
    container.innerHTML = grievanceList.map(grievance => `
        <div class="col-md-6 mb-3">
            <div class="card grievance-card priority-${grievance.priority}">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="card-title mb-1">${grievance.title}</h6>
                        <span class="badge bg-${getStatusColor(grievance.status)}">${grievance.status}</span>
                    </div>
                    <p class="card-text text-muted small">${grievance.description.substring(0, 100)}...</p>
                    <div class="row text-muted small">
                        <div class="col-6">
                            <i class="fas fa-tag me-1"></i>${grievance.category}
                        </div>
                        <div class="col-6">
                            <i class="fas fa-calendar me-1"></i>${new Date(grievance.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                    <div class="mt-3">
                        <button class="btn btn-sm btn-primary" onclick="viewGrievance('${grievance._id}')">
                            <i class="fas fa-eye me-1"></i>View Details
                        </button>
                        ${grievance.status === 'submitted' || grievance.status === 'under_review' ? 
                            `<button class="btn btn-sm btn-warning ms-2" onclick="escalateGrievance('${grievance._id}')">
                                <i class="fas fa-level-up-alt me-1"></i>Escalate
                            </button>` : ''
                        }
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function getStatusColor(status) {
    const colors = {
        'submitted': 'primary',
        'under_review': 'info',
        'in_progress': 'warning',
        'resolved': 'success',
        'escalated': 'danger',
        'closed': 'secondary'
    };
    return colors[status] || 'secondary';
}

async function viewGrievance(grievanceId) {
    try {
        const response = await fetch(`/api/grievances/${grievanceId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const grievance = await response.json();
        
        if (response.ok) {
            showGrievanceDetails(grievance);
        } else {
            showNotification('Failed to load grievance details', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}

function showGrievanceDetails(grievance) {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Grievance Details</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="row mb-3">
                        <div class="col-md-6">
                            <strong>Grievance ID:</strong> ${grievance.grievanceId}
                        </div>
                        <div class="col-md-6">
                            <strong>Status:</strong> <span class="badge bg-${getStatusColor(grievance.status)}">${grievance.status}</span>
                        </div>
                    </div>
                    <div class="row mb-3">
                        <div class="col-md-6">
                            <strong>Category:</strong> ${grievance.category}
                        </div>
                        <div class="col-md-6">
                            <strong>Priority:</strong> ${grievance.priority}
                        </div>
                    </div>
                    <div class="mb-3">
                        <strong>Title:</strong> ${grievance.title}
                    </div>
                    <div class="mb-3">
                        <strong>Description:</strong><br>
                        ${grievance.description}
                    </div>
                    ${grievance.location ? `<div class="mb-3"><strong>Location:</strong> ${grievance.location}</div>` : ''}
                    <div class="mb-3">
                        <strong>Timeline:</strong>
                        <div class="timeline mt-3">
                            ${grievance.timeline.map(item => `
                                <div class="timeline-item">
                                    <div class="timeline-content">
                                        <strong>${item.status}</strong> - ${new Date(item.timestamp).toLocaleString()}<br>
                                        <small>${item.comment}</small>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                    ${currentUser && currentUser.role !== 'citizen' && grievance.status !== 'resolved' ? 
                        `<button type="button" class="btn btn-primary" onclick="updateGrievanceStatusModal('${grievance._id}')">Update Status</button>` : ''
                    }
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    modal.addEventListener('hidden.bs.modal', function() {
        document.body.removeChild(modal);
    });
}

async function escalateGrievance(grievanceId) {
    const reason = prompt('Please provide a reason for escalation:');
    if (!reason) return;
    
    try {
        const response = await fetch(`/api/grievances/${grievanceId}/escalate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ reason })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Grievance escalated successfully', 'success');
            loadUserGrievances();
        } else {
            showNotification(data.message || 'Failed to escalate grievance', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}

// Dashboard functions
async function loadDashboardGrievances() {
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/grievances', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            displayDashboardGrievances(data.grievances);
        }
    } catch (error) {
        console.error('Failed to load dashboard grievances:', error);
    }
}

function displayDashboardGrievances(grievanceList) {
    const tbody = document.getElementById('dashboardGrievances');
    if (!tbody) return;
    
    if (grievanceList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No grievances found</td></tr>';
        return;
    }
    
    tbody.innerHTML = grievanceList.slice(0, 10).map(grievance => `
        <tr>
            <td>${grievance.grievanceId}</td>
            <td>${grievance.title}</td>
            <td><span class="badge bg-${getStatusColor(grievance.status)}">${grievance.status}</span></td>
            <td><span class="badge bg-${getPriorityColor(grievance.priority)}">${grievance.priority}</span></td>
            <td>${new Date(grievance.createdAt).toLocaleDateString()}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="viewGrievance('${grievance._id}')">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

function getPriorityColor(priority) {
    const colors = {
        'low': 'success',
        'medium': 'warning',
        'high': 'danger',
        'critical': 'danger'
    };
    return colors[priority] || 'secondary';
}

async function loadStatistics() {
    try {
        const response = await fetch('/api/dashboard/stats', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('totalGrievances').textContent = data.total;
            document.getElementById('resolvedGrievances').textContent = data.resolved;
            document.getElementById('pendingGrievances').textContent = data.pending;
            document.getElementById('resolutionRate').textContent = data.resolutionRate + '%';
        }
    } catch (error) {
        console.error('Failed to load statistics:', error);
    }
}

// Chart functions
function loadDashboardCharts() {
    // Status distribution chart
    const statusCtx = document.getElementById('statusChart');
    if (statusCtx) {
        new Chart(statusCtx, {
            type: 'doughnut',
            data: {
                labels: ['Submitted', 'Under Review', 'In Progress', 'Resolved', 'Escalated'],
                datasets: [{
                    data: [10, 15, 20, 45, 10],
                    backgroundColor: [
                        '#667eea',
                        '#17a2b8',
                        '#ffc107',
                        '#28a745',
                        '#dc3545'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }
}

// Report functions
async function generateReport() {
    // Implementation for generating reports
    showNotification('Report generation feature coming soon', 'info');
}

function downloadReport() {
    // Implementation for downloading reports
    showNotification('Report download feature coming soon', 'info');
}

function exportReport() {
    // Implementation for exporting reports
    showNotification('Export feature coming soon', 'info');
}

function showEscalated() {
    // Implementation for showing escalated cases
    showNotification('Escalated cases view coming soon', 'info');
}

// Utility functions
function showNotification(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        if (alertDiv.parentNode) {
            alertDiv.parentNode.removeChild(alertDiv);
        }
    }, 5000);
}

function searchGrievances() {
    const searchTerm = document.getElementById('searchGrievance').value.toLowerCase();
    
    if (!searchTerm) {
        displayGrievances(grievances);
        return;
    }
    
    const filtered = grievances.filter(grievance => 
        grievance.grievanceId.toLowerCase().includes(searchTerm) ||
        grievance.title.toLowerCase().includes(searchTerm) ||
        grievance.description.toLowerCase().includes(searchTerm)
    );
    
    displayGrievances(filtered);
}

// Update grievance status (for officials)
function updateGrievanceStatusModal(grievanceId) {
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Update Grievance Status</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <form id="updateStatusForm">
                        <div class="mb-3">
                            <label class="form-label">New Status</label>
                            <select class="form-select" id="newStatus" required>
                                <option value="under_review">Under Review</option>
                                <option value="in_progress">In Progress</option>
                                <option value="resolved">Resolved</option>
                                <option value="closed">Closed</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Comment</label>
                            <textarea class="form-control" id="statusComment" rows="3" required></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary">Update Status</button>
                    </form>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
    
    document.getElementById('updateStatusForm').addEventListener('submit', function(e) {
        e.preventDefault();
        updateGrievanceStatus(grievanceId, document.getElementById('newStatus').value, document.getElementById('statusComment').value);
        bsModal.hide();
    });
    
    modal.addEventListener('hidden.bs.modal', function() {
        document.body.removeChild(modal);
    });
}

async function updateGrievanceStatus(grievanceId, status, comment) {
    try {
        const response = await fetch(`/api/grievances/${grievanceId}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status, comment })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Status updated successfully', 'success');
            loadUserGrievances();
            loadDashboardGrievances();
        } else {
            showNotification(data.message || 'Failed to update status', 'error');
        }
    } catch (error) {
        showNotification('Network error. Please try again.', 'error');
    }
}
