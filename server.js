const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const moment = require('moment');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDFs are allowed'));
    }
  }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/grievance_portal', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['citizen', 'official', 'admin'], default: 'citizen' },
  department: { type: String },
  phone: { type: String },
  address: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Grievance Schema
const grievanceSchema = new mongoose.Schema({
  grievanceId: { type: String, unique: true, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  subcategory: { type: String },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['submitted', 'under_review', 'in_progress', 'resolved', 'escalated', 'closed'], default: 'submitted' },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  department: { type: String, required: true },
  location: { type: String },
  attachments: [{ type: String }],
  timeline: [{
    status: { type: String },
    comment: { type: String },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now }
  }],
  slaDeadline: { type: Date },
  escalationLevel: { type: Number, default: 0 },
  escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  citizenFeedback: { type: String },
  citizenRating: { type: Number, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Department Schema
const departmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String },
  head: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  slaDays: { type: Number, default: 7 },
  categories: [{ type: String }]
});

const User = mongoose.model('User', userSchema);
const Grievance = mongoose.model('Grievance', grievanceSchema);
const Department = mongoose.model('Department', departmentSchema);

// JWT middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_grievance', (grievanceId) => {
    socket.join(grievanceId);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Helper function to generate grievance ID
const generateGrievanceId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `GRV${year}${random}`;
};

// Routes

// Authentication routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, role, phone, address } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      email,
      password: hashedPassword,
      role: role || 'citizen',
      phone,
      address
    });

    await user.save();
    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });

    res.status(201).json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id, role: user.role }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });
    res.json({ token, user: { id: user._id, username: user.username, email: user.email, role: user.role } });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Grievance routes
app.post('/api/grievances', authenticateToken, upload.array('attachments', 5), async (req, res) => {
  try {
    const { title, description, category, subcategory, priority, department, location } = req.body;
    
    const grievanceId = generateGrievanceId();
    const attachments = req.files ? req.files.map(file => file.path) : [];
    
    // Calculate SLA deadline
    const dept = await Department.findOne({ name: department });
    const slaDays = dept ? dept.slaDays : 7;
    const slaDeadline = moment().add(slaDays, 'days').toDate();

    const grievance = new Grievance({
      grievanceId,
      title,
      description,
      category,
      subcategory,
      priority,
      submittedBy: req.user.userId,
      department,
      location,
      attachments,
      slaDeadline,
      timeline: [{
        status: 'submitted',
        comment: 'Grievance submitted successfully',
        updatedBy: req.user.userId
      }]
    });

    await grievance.save();

    // Notify relevant officials
    io.emit('new_grievance', {
      grievanceId: grievance._id,
      department,
      priority
    });

    res.status(201).json(grievance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/grievances', authenticateToken, async (req, res) => {
  try {
    const { status, department, page = 1, limit = 10 } = req.query;
    const filter = {};

    if (req.user.role === 'citizen') {
      filter.submittedBy = req.user.userId;
    } else if (req.user.role === 'official') {
      filter.department = req.user.department;
    }

    if (status) filter.status = status;
    if (department) filter.department = department;

    const grievances = await Grievance.find(filter)
      .populate('submittedBy', 'username email')
      .populate('assignedTo', 'username email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Grievance.countDocuments(filter);

    res.json({
      grievances,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/grievances/:id', authenticateToken, async (req, res) => {
  try {
    const grievance = await Grievance.findById(req.params.id)
      .populate('submittedBy', 'username email phone')
      .populate('assignedTo', 'username email')
      .populate('timeline.updatedBy', 'username email');

    if (!grievance) {
      return res.status(404).json({ message: 'Grievance not found' });
    }

    // Check access permissions
    if (req.user.role === 'citizen' && grievance.submittedBy._id.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(grievance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/grievances/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, comment } = req.body;
    const grievance = await Grievance.findById(req.params.id);

    if (!grievance) {
      return res.status(404).json({ message: 'Grievance not found' });
    }

    grievance.status = status;
    grievance.timeline.push({
      status,
      comment,
      updatedBy: req.user.userId
    });

    if (status === 'resolved') {
      grievance.resolvedAt = new Date();
    }

    await grievance.save();

    // Notify stakeholders
    io.to(grievance._id.toString()).emit('status_update', {
      grievanceId: grievance._id,
      status,
      comment
    });

    res.json(grievance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/grievances/:id/escalate', authenticateToken, async (req, res) => {
  try {
    const { reason } = req.body;
    const grievance = await Grievance.findById(req.params.id);

    if (!grievance) {
      return res.status(404).json({ message: 'Grievance not found' });
    }

    grievance.escalationLevel += 1;
    grievance.status = 'escalated';
    grievance.timeline.push({
      status: 'escalated',
      comment: reason,
      updatedBy: req.user.userId
    });

    await grievance.save();

    // Notify higher authorities
    io.emit('escalation', {
      grievanceId: grievance._id,
      escalationLevel: grievance.escalationLevel,
      department: grievance.department
    });

    res.json(grievance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Dashboard analytics
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    let matchQuery = {};
    
    if (req.user.role === 'citizen') {
      matchQuery.submittedBy = mongoose.Types.ObjectId(req.user.userId);
    } else if (req.user.role === 'official') {
      matchQuery.department = req.user.department;
    }

    const stats = await Grievance.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalGrievances = await Grievance.countDocuments(matchQuery);
    const resolvedGrievances = await Grievance.countDocuments({ ...matchQuery, status: 'resolved' });
    const pendingGrievances = totalGrievances - resolvedGrievances;
    const escalatedGrievances = await Grievance.countDocuments({ ...matchQuery, status: 'escalated' });

    res.json({
      total: totalGrievances,
      resolved: resolvedGrievances,
      pending: pendingGrievances,
      escalated: escalatedGrievances,
      resolutionRate: totalGrievances > 0 ? (resolvedGrievances / totalGrievances * 100).toFixed(2) : 0,
      statusBreakdown: stats
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Serve static files
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
