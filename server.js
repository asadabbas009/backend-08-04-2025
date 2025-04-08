const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise.js');
require('dotenv').config();
const path = require('path');
const multer = require('multer'); // Add this line at the top



const app = express();
app.use(cors());
app.use(bodyParser.json());
// backend Express.js code (final and correct solution)

//const cors = require('cors');

const allowedOrigins = [
  'https://www.onelearningedusphere.com',
  'https://onelearningedusphere.com',
  'http://localhost:3000'
];


const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, origin); // allow the specific requesting origin
    } else {
      callback(new Error('Origin not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// app.use(bodyParser.json());

// const app = express();

// // Configure CORS
// const corsOptions = {
//   origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Use environment variable for frontend URL
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization']
// };

// app.use(cors(corsOptions));
// app.use(bodyParser.json());

// // Handle preflight requests
// app.options('*', cors(corsOptions));

// Configure MySQL connection with error handling
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test database connection
pool.getConnection()
  .then((conn) => {
    console.log("Connected to the database successfully!");
    conn.release();
  })
  .catch((err) => {
    console.error("Database connection error:", err.message);
  });

// Debugging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`, req.body);
  next();
});
const upload = multer({ storage: multer.memoryStorage() });


app.post('/api/save-report-pdf', async (req, res) => {
  try {
    const { registration_id, pdf_data, reported_at, username } = req.body;
    
    // Validate required fields
    if (!registration_id || !pdf_data) {
      return res.status(400).json({
        success: false,
        message: 'Registration ID and PDF data are required'
      });
    }
    
    // Remove the data URI prefix if present
    const processedPdfData = pdf_data.includes(',')
      ? pdf_data.split(',')[1]
      : pdf_data;
    
    // Convert reported_at (ISO format) to MySQL DATETIME format
    const reportTimeISO = reported_at || new Date().toISOString();
    const mysqlReportTime = reportTimeISO.slice(0, 19).replace('T', ' ');
    
    const query = `
      INSERT INTO report_pdfs (registration_id, pdf_data, reported_at, username, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `;
    const values = [registration_id, processedPdfData, mysqlReportTime, username || "UnknownUser"];
    
    const [result] = await pool.execute(query, values);
    
    res.status(201).json({
      success: true,
      message: 'PDF report saved successfully',
      data: {
        id: result.insertId,
        registration_id,
        reported_at: mysqlReportTime,
        username: username || "UnknownUser"
      }
    });
    
  } catch (error) {
    console.error('Error saving PDF report:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while saving PDF report',
      error: error.message,
    });
  }
});


app.get('/api/get-all-report-pdfs', async (req, res) => {
  try {
    // Select all records from the report_pdfs table, ordered by creation time (newest first)
    const query = `
      SELECT id, registration_id, pdf_data, reported_at,username, created_at
      FROM report_pdfs
      ORDER BY created_at DESC
    `;
    const [rows] = await pool.execute(query);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching all PDF reports:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});



app.get('/api/cases', async (req, res) => {
  try {
    const query = `SELECT * FROM cases`;
    const [results] = await pool.query(query);
    res.json(results);
  } catch (err) {
    console.error('Error fetching cases:', err);
    res.status(500).json({ error: 'Failed to fetch cases.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;

  try {
    const query = `SELECT * FROM users WHERE email = ? AND role = ?`;
    const [results] = await pool.query(query, [email, role]);

    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Database query error:', err.message);
    res.status(500).json({ error: 'Database error occurred.' });
  }
});


app.post('/api/signup', async (req, res) => {
  const { username, name, email, password, role, academic_year } = req.body;

  try {
    // Check if username or email already exists.
    const [existingUser] = await pool.query(
      `SELECT * FROM users WHERE username = ? OR email = ?`,
      [username, email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Username or Email already exists. Choose another one.' });
    }

    // For students, academic_year is required.
    if (role === 'student') {
      if (!academic_year || isNaN(academic_year)) {
        return res.status(400).json({ error: 'Academic year is required and must be a valid number for students.' });
      }
    }

    // Hash the password.
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user. For non-students, academic_year is set to NULL.
    const insertQuery = `
      INSERT INTO users (username, name, email, password_hash, role, academic_year)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    await pool.query(insertQuery, [
      username,
      name,
      email,
      hashedPassword,
      role,
      role === 'student' ? academic_year : null
    ]);

    res.status(201).json({ message: 'User created successfully!' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'An error occurred while processing your request.' });
  }
});


app.get('/api/students', async (req, res) => {
  const { year } = req.query;
  
  if (!year) {
    console.error("No 'year' query parameter provided");
    return res.status(400).json({ error: 'Year query parameter is required.' });
  }

  try {
    // Convert the year parameter to an integer.
    const yearParam = parseInt(year, 10);
    console.log("Requested academic_year (raw):", year, "Converted to:", yearParam);

    const query = `
      SELECT id, name, username 
      FROM users 
      WHERE role = 'student' AND academic_year = ?
    `;
    const [students] = await pool.query(query, [yearParam]);

    console.log("Query result:", students);
    
    res.json({ students });
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'An error occurred while fetching students.' });
  }
});

app.get('/api/topics', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM topics');
    res.status(200).json(rows);
  } catch (error) {
      console.error('Failed to fetch topics:', error);
      res.status(500).json({ message: 'Failed to fetch topics from the database' });
  }
});


app.get("/api/dashboard-stats", async (req, res) => {
  try {
    console.log("📩 Received query params:", req.query); // Log incoming query params

    const { username } = req.query;

    if (!username) {
      console.warn("⚠️ Missing username in request!");
      return res.status(400).json({ error: "Username is required" });
    }

    console.log(`✅ Fetching data for username: ${username}`);

    // Fetch assigned and available courses for the specific username
    const [[assignedCoursesResult], [availableCoursesResult], [tableCheck]] = await Promise.all([
      pool.query(
        "SELECT COUNT(*) AS assignedCourses FROM case_assignments WHERE student_name = ?",
        [username]
      ),
      pool.query(
        "SELECT COUNT(*) AS availableCourses FROM courses"
      ),
      pool.query(
        "SELECT COUNT(*) AS tableExists FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'amendments'"
      )
    ]);

    console.log("📊 Query Results:");
    console.log("➡️ Assigned Courses Result:", assignedCoursesResult);
    console.log("➡️ Available Courses Result:", availableCoursesResult);
    console.log("➡️ Table Check:", tableCheck);

    let amendmentsCount = 0; // Default value if table does not exist

    if (tableCheck.length > 0 && tableCheck[0].tableExists > 0) {
      try {
        const [amendmentsResult] = await pool.query(
          "SELECT COUNT(*) AS amendments FROM amendments WHERE student_name = ?",
          [username]
        );
        amendmentsCount = amendmentsResult[0]?.amendments || 0;
        console.log(`✅ Amendments count for ${username}:`, amendmentsCount);
      } catch (error) {
        console.warn("⚠️ Could not fetch amendments count, defaulting to 0:", error);
      }
    } else {
      console.warn("⚠️ Amendments table does not exist, skipping query.");
    }

    const response = {
      username: username,
      assignedCourses: assignedCoursesResult?.[0]?.assignedCourses || 0,
      availableCourses: availableCoursesResult?.[0]?.availableCourses || 0,
      amendments: amendmentsCount,
    };

    console.log("📤 Sending Response:", response);
    res.json(response);

  } catch (error) {
    console.error("❌ Error in fetching dashboard stats:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.get('/api/patient-registrations', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: "Missing userId parameter" });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT 
         registration_id,
         course_id,
         name,
         age,
         gender,
         phone,
         email,
         address,
         emergency_contact,
         kin_name,
         kin_relation,
         kin_phone,
         agreement,
         created_at,
         user_id
       FROM patients
       WHERE user_id = ?`,
      [userId]
    );
    res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching patient registrations:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// app.get('/api/patient-scan-images/:patient_id', async (req, res) => {
//   const { patient_id } = req.params;

//   try {
//     // Query the patient_scan_images table for the given patient_id.
//     const [rows] = await pool.execute(
//       "SELECT image FROM patient_scan_images WHERE patient_id = ?",
//       [patient_id]
//     );

//     if (rows.length === 0) {
//       return res.status(404).json({ message: "No scan image found for this patient" });
//     }

//     const imageBuffer = rows[0].image;
//     if (!imageBuffer) {
//       return res.status(404).json({ message: "Image data not found" });
//     }

//     // Convert the image buffer to a base64 string.
//     const base64Image = Buffer.from(imageBuffer).toString('base64');
//     // Assuming the stored image is in JPEG format; adjust if needed.
//     const dataUri = `data:image/jpeg;base64,${base64Image}`;

//     res.status(200).json({ image: dataUri });
//   } catch (error) {
//     console.error("Error fetching patient scan image:", error);
//     res.status(500).json({ error: "Internal server error" });
//   }
// });


app.get('/api/patient-scan-images/:patient_id', async (req, res) => {
  const { patient_id } = req.params;

  try {
    // Query the patient_scan_images table for the given patient_id.
    const [rows] = await pool.execute(
      "SELECT image FROM patient_scan_images WHERE patient_id = ?",
      [patient_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "No scan image found for this patient" });
    }

    // Convert each image buffer to a base64 data URI.
    const images = rows
      .map(row => {
        if (!row.image) return null;
        const base64Image = Buffer.from(row.image).toString('base64');
        return `data:image/jpeg;base64,${base64Image}`;
      })
      .filter(image => image !== null);

    res.status(200).json(images);
  } catch (error) {
    console.error("Error fetching patient scan images:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.get('/api/courses/:topicId', async (req, res) => {
  try {
      const { topicId } = req.params;
      const [rows] = await pool.query(
          'SELECT id, title, description FROM courses WHERE topic_id = ?',
          [topicId]
      );
      res.status(200).json(rows);
  } catch (error) {
      console.error('Failed to fetch courses:', error);
      res.status(500).json({ message: 'Failed to fetch courses from the database' });
  }
});


app.get('/api/course-overview/:courseId', async (req, res) => {
  try {
      const { courseId } = req.params;
      const [rows] = await pool.query(
          'SELECT * FROM course_overviews WHERE course_id = ?',
          [courseId]
      );

      if (rows.length === 0) {
          return res.status(404).json({ message: "Course overview not found" });
      }

      // Assuming rows[0].objectives, rows[0].structure, and rows[0].details are already objects
      const courseOverview = {
          ...rows[0],
          objectives: rows[0].objectives,
          structure: rows[0].structure,
          details: rows[0].details
      };

      res.status(200).json(courseOverview);
  } catch (error) {
      console.error('Failed to fetch course overview:', error);
      res.status(500).json({ message: 'Failed to fetch course overview from the database' });
  }
});


app.post('/api/patient-registration', async (req, res) => {
  const {
    registration_id,
    user_id,       // Include user_id from the request body
    courseId,
    name,
    age,
    gender,
    phone,
    email,
    address,
    emergencyContact,
    kinName,
    kinRelation,
    kinPhone,
    agreement
  } = req.body;

  try {
    const query = `
      INSERT INTO patients (
        registration_id, user_id, course_id, name, age, gender, phone, email, address, emergency_contact, kin_name, kin_relation, kin_phone, agreement, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await pool.query(query, [
      registration_id,
      user_id, // Now passing user_id as part of the insert
      courseId,
      name,
      age,
      gender,
      phone,
      email,
      address,
      emergencyContact,
      kinName,
      kinRelation,
      kinPhone,
      agreement ? 1 : 0  // Converting boolean to numeric if needed
    ]);

    res.status(201).json({ message: 'Patient registered successfully!' });
  } catch (error) {
    console.error('Failed to register patient:', error);
    res.status(500).json({ message: 'Failed to register patient' });
  }
});


app.post('/api/consent-form', async (req, res) => {
  const {
    patientName,
    age,
    sex,
    hospitalID,
    ctNumber,
    opdIPD,
    bedNumber,
    refPhysician,
    date,
    pregnancy,
    dateOfLMP,
    clinicalHistory,
    previousScans,
    areaOfInterest,
    medicalHistory,
    chemoRadioTherapy,
    serumCreatinine,
    creatinineTestDate,
    patientSignature,
    techSignature,
    radiologistSignature,
    patientDate,
    techDate,
    radiologistDate,
    registration_id
  } = req.body;

  try {
    const query = `
      INSERT INTO consent_forms (patient_name, age, sex, hospital_id, ct_number, opd_ipd, bed_number, ref_physician, date, pregnancy, date_of_lmp, clinical_history, previous_scans, area_of_interest, medical_history, chemo_radio_therapy, serum_creatinine, creatinine_test_date, patient_signature, tech_signature, radiologist_signature, patient_date, tech_date, radiologist_date, registration_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await pool.query(query, [
      patientName,
      age,
      sex,
      hospitalID,
      ctNumber,
      opdIPD,
      bedNumber,
      refPhysician,
      date,
      pregnancy,
      dateOfLMP,
      clinicalHistory,
      previousScans,
      areaOfInterest,
      medicalHistory,
      chemoRadioTherapy,
      serumCreatinine,
      creatinineTestDate,
      patientSignature,
      techSignature,
      radiologistSignature,
      patientDate,
      techDate,
      radiologistDate,
      registration_id
    ]);

    res.status(201).json({ message: 'Consent form submitted successfully!' });
  } catch (error) {
    console.error('Failed to submit consent form:', error);
    res.status(500).json({ message: 'Failed to submit consent form' });
  }
});



app.post('/api/image-analysis', upload.array('selected_images', 10), async (req, res) => {
  try {
    const { user_id, registration_id, finding, impression } = req.body;
    
    // Validate required fields
    if (!user_id || !registration_id || !finding || !impression) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Ensure files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }
    
    // Insert the main analysis record (without images)
    const analysisQuery = `
      INSERT INTO image_analysis (
        user_id, registration_id, finding, impression, created_at
      )
      VALUES (?, ?, ?, ?, NOW())
    `;
    const analysisValues = [user_id, registration_id, finding, impression];
    const [analysisResult] = await pool.execute(analysisQuery, analysisValues);
    const analysisId = analysisResult.insertId;
    
    // Convert each file buffer to a base64 string and form a Data URI
    const imagesArray = req.files.map(file => {
      const base64Data = file.buffer.toString('base64');
      return `data:${file.mimetype};base64,${base64Data}`;
    });
    
    // Update the record to store the images array as JSON (or TEXT) in selected_image column
    const updateQuery = `UPDATE image_analysis SET selected_image = ? WHERE id = ?`;
    await pool.execute(updateQuery, [JSON.stringify(imagesArray), analysisId]);
    
    res.status(201).json({
      message: 'Image analysis data submitted successfully',
      id: analysisId,
    });
  } catch (error) {
    console.error('Error inserting image analysis data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// GET endpoint to fetch image analysis data by registration_id
app.get('/api/image-analysis/:registration_id', async (req, res) => {
  try {
    const { registration_id } = req.params;
    const query = "SELECT * FROM image_analysis WHERE registration_id = ?";
    const [rows] = await pool.execute(query, [registration_id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "No image analysis data found" });
    }

    // Assuming one record per registration_id
    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching image analysis data:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get('/api/patient-registration/:registration_id', async (req, res) => {
  const { registration_id } = req.params;
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM patients WHERE registration_id = ?",
      [registration_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "No registration data found" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching registration data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/assignments', async (req, res) => {
  const { moduleId, selectedCourses, selectedStudents } = req.body;
  
  // Basic validation
  if (!moduleId || !Array.isArray(selectedCourses) || !Array.isArray(selectedStudents)) {
    return res.status(400).json({ error: "Missing or invalid required fields." });
  }
  
  const connection = await pool.getConnection();
  try {
    // Start a transaction
    await connection.beginTransaction();
    
    // Insert the assignment record
    const [assignmentResult] = await connection.query(
      `INSERT INTO assignments (module_id) VALUES (?)`,
      [moduleId]
    );
    const assignmentId = assignmentResult.insertId;
    console.log("New assignment created with ID:", assignmentId);
    
    // Insert into assignment_courses if courses are selected
    if (selectedCourses.length > 0) {
      const courseValues = selectedCourses.map(courseId => [assignmentId, courseId]);
      await connection.query(
        `INSERT INTO assignment_courses (assignment_id, course_id) VALUES ?`,
        [courseValues]
      );
      console.log("Assigned courses:", selectedCourses);
    }
    
    // Insert into assignment_students if students are selected
    if (selectedStudents.length > 0) {
      const studentValues = selectedStudents.map(studentId => [assignmentId, studentId]);
      await connection.query(
        `INSERT INTO assignment_students (assignment_id, student_id) VALUES ?`,
        [studentValues]
      );
      console.log("Assigned students:", selectedStudents);
    }
    
    // Commit the transaction
    await connection.commit();
    
    res.status(201).json({ message: "Assignment published successfully!" });
  } catch (error) {
    await connection.rollback();
    console.error("Error publishing assignment:", error);
    res.status(500).json({ error: "An error occurred while publishing the assignment." });
  } finally {
    connection.release();
  }
});

app.get('/api/courses/:moduleId', async (req, res) => {
  const { moduleId } = req.params;
  try {
    const query = `
      SELECT 
        c.id, 
        c.topic_id, 
        c.title, 
        c.description,
        t.title AS topic_title,
        t.description AS topic_description
      FROM courses c
      LEFT JOIN topics t ON c.topic_id = t.id
      WHERE c.topic_id = ?
    `;
    const [courses] = await pool.query(query, [moduleId]);
    console.log("Fetched courses for moduleId", moduleId, courses);
    res.json(courses);
  } catch (error) {
    console.error("Error fetching courses:", error);
    res.status(500).json({ error: "Error fetching courses." });
  }
});

// Endpoint: GET /api/assignments/topic/:topicId
app.get('/api/assignments/topic/:topicId', async (req, res) => {
  const { topicId } = req.params;
  try {
    // Fetch assignments whose module_id equals the provided topicId.
    // If you wish to include course IDs, we group them with GROUP_CONCAT.
    const query = `
      SELECT 
        a.id AS assignmentId,
        a.module_id,
        a.created_at,
        GROUP_CONCAT(ac.course_id) AS courseIds
      FROM assignments a
      LEFT JOIN assignment_courses ac ON a.id = ac.assignment_id
      WHERE a.module_id = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `;
    const [assignments] = await pool.query(query, [topicId]);
    res.json(assignments);
  } catch (error) {
    console.error("Error fetching assignments by topic:", error);
    res.status(500).json({ error: "Error fetching assignments by topic." });
  }
});

// Endpoint: GET /api/student/topics/:studentId
app.get('/api/student/topics/:studentId', async (req, res) => {
  const { studentId } = req.params;
  try {
    // This query returns distinct topics (modules) that have at least one assignment
    // assigned to the given student.
    const query = `
      SELECT DISTINCT t.id, t.title, t.description 
      FROM topics t 
      JOIN assignments a ON t.id = a.module_id 
      JOIN assignment_students ast ON a.id = ast.assignment_id 
      WHERE ast.student_id = ?
    `;
    const [topics] = await pool.query(query, [studentId]);
    res.json(topics);
  } catch (error) {
    console.error("Error fetching student topics:", error);
    res.status(500).json({ error: "Error fetching topics for student." });
  }
});
// Endpoint: GET /api/student/courses/:topicId/:studentId
app.get('/api/student/courses/:topicId/:studentId', async (req, res) => {
  const { topicId, studentId } = req.params;
  try {
    const query = `
      SELECT DISTINCT c.id, c.title, c.description
      FROM assignments a
      JOIN assignment_students ast ON a.id = ast.assignment_id
      JOIN assignment_courses ac ON a.id = ac.assignment_id
      JOIN courses c ON ac.course_id = c.id
      WHERE a.module_id = ? AND ast.student_id = ?
    `;
    const [courses] = await pool.query(query, [topicId, studentId]);
    res.json(courses);
  } catch (error) {
    console.error("Error fetching student courses:", error);
    res.status(500).json({ error: "Failed to fetch courses for student." });
  }
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  
  console.log(`Server running on http://localhost:${PORT}`);
});

