// Import necessary modules
const fs = require('fs');
const nodemailer = require('nodemailer');

// Your existing logic...

// Calculate seven days ago
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

// Your existing logic...

// Modify lines 105-117 for history persistence
if (startDate < sevenDaysAgo) {
    // Remove old entries...
}

// Your existing logic...

// Email sending logic...
nodemailer.createTransport(...);
transporter.sendMail(..., (error, info) => {
    if (error) {
        return console.log(error);
    }
    console.log('Email sent: ' + info.response);
    // Move fs.writeFileSync here after successful email send
    fs.writeFileSync('filepath', 'data'); // Adjust with actual file path and data
});

// Continue with the rest of your logic
