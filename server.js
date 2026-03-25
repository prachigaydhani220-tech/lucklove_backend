const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors());
app.use(bodyParser.json());

// 🔐 JWT Secret Key
const SECRET_KEY = "lucklove_secret_key";

// ============================
// TOKEN GENERATOR
// ============================
function generateToken(userId, email) {
  return jwt.sign(
    { id: userId, email: email },
    SECRET_KEY,
    { expiresIn: '2h' }
  );
}

// ============================
// MYSQL CONNECTION
// ============================
const db = mysql.createConnection({
  host: 'yamabiko.proxy.rlwy.net',
  user: 'root',
  password: 'ZuGOmgfIVjzlhcKbQLfCYHkhiNZxiGvJ',
  database: 'railway',
  port: 23812,

  ssl: {
    rejectUnauthorized: false
  }
});

db.connect((err) => {
  if (err) console.log('Database connection failed', err);
  else console.log('MySQL Connected');
});

// ============================
// EMAIL TRANSPORT
// ============================
const transporter = nodemailer.createTransport({

  host: "smtp.gmail.com",
  port: 587,
  secure: false,

  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },

  requireTLS: true,

  tls: {
    rejectUnauthorized: false
  }

});

// verify connection
transporter.verify(function(error, success) {

  if (error) {
    console.log("SMTP ERROR:", error);
  } else {
    console.log("SMTP READY");
  }

});

// ============================
// 🟢 SIGNUP API
// ============================
app.post('/signup', (req, res) => {

  const { name, email, password } = req.body;

  const sql =
    "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

  db.query(sql, [name, email, password], (err, result) => {

    if (err) return res.status(500).send(err);

    const userId = result.insertId;

    console.log("New user created:", userId);

    db.query(
      "INSERT INTO wallets (user_id, balance) VALUES (?, 0)",
      [userId]
    );

    res.send({ message: "User created and wallet initialized" });
  });
});

// ============================
// 🔐 GOOGLE LOGIN API
// ============================
app.post('/googleLogin', (req, res) => {

  const { name, email } = req.body;

  console.log("Google login request:", email);

  const findUser = "SELECT * FROM users WHERE email = ?";

  db.query(findUser, [email], (err, result) => {

    if (err) return res.status(500).send(err);

    if (result.length > 0) {

      const user = result[0];
      const token = generateToken(user.id, user.email);

      return res.send({
        token: token,
        name: user.name,
        email: user.email
      });
    }

    const insertUser =
      "INSERT INTO users (name, email, password) VALUES (?, ?, ?)";

    db.query(insertUser, [name, email, "google_user"], (err, result) => {

      if (err) return res.status(500).send(err);

      const userId = result.insertId;

      db.query(
        "INSERT INTO wallets (user_id, balance) VALUES (?, 0)",
        [userId]
      );

      const token = generateToken(userId, email);

      res.send({
        token: token,
        name: name,
        email: email
      });
    });
  });
});

// ============================
// 🔐 LOGIN API
// ============================
app.post('/login', (req, res) => {

  const { email, password } = req.body;

  const sql =
    "SELECT * FROM users WHERE email = ? AND password = ?";

  db.query(sql, [email, password], (err, result) => {

    if (err) return res.status(500).send(err);

    if (result.length === 0) {
      return res.status(401).send({
        message: "Invalid email or password"
      });
    }

    const user = result[0];

    const token = generateToken(user.id, user.email);

    res.send({
      token: token,
      name: user.name,
      email: user.email
    });
  });
});

// ============================
// 🔐 JWT MIDDLEWARE
// ============================
function authenticateToken(req, res, next) {

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token)
    return res.status(401).send({ message: "Token missing" });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err)
      return res.status(403).send({ message: "Invalid token" });

    req.user = user;
    next();
  });
}

// ============================
// 💰 WALLET BALANCE
// ============================
app.get('/wallet', authenticateToken, (req, res) => {

  const userId = req.user.id;

  db.query(
    "SELECT balance FROM wallets WHERE user_id = ?",
    [userId],
    (err, result) => {

      if (err) return res.status(500).send(err);

      if (result.length === 0)
        return res.send({ balance: 0 });

      res.send({ balance: result[0].balance });
    }
  );
});

// ============================
// 💰 ADD MONEY
// ============================
app.post('/wallet/add', authenticateToken, (req, res) => {

  const userId = req.user.id;
  const { amount } = req.body;

  db.query(
    "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
    [amount, userId],
    (err) => {

      if (err) return res.status(500).send(err);

      db.query(
        "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
        [userId, userId, amount],
        (err2) => {

          if (err2) return res.status(500).send(err2);

          res.send({ message: "Money added successfully" });

        }
      );

    }
  );

});

// ============================
// 💸 WITHDRAW MONEY
// ============================
app.post('/wallet/withdraw', authenticateToken, (req, res) => {

  const userId = req.user.id;
  const { amount } = req.body;

  db.query(
    "SELECT balance FROM wallets WHERE user_id = ?",
    [userId],
    (err, result) => {

      if (err) return res.status(500).send(err);

      const currentBalance = result[0].balance;

      if (currentBalance < amount) {
        return res.status(400).send({
          message: "Insufficient balance"
        });
      }

      db.query(
        "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
        [amount, userId],
        (err) => {

          if (err) return res.status(500).send(err);

          db.query(
            "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
            [userId, userId, -amount]
          );

          res.send({
            message: "Withdraw successful"
          });

        }
      );
    }
  );
});

// ============================
// 🔴 NEW API ADDED (FIX)
// ============================
app.post('/wallet/transfer', authenticateToken, (req, res) => {

  const senderId = req.user.id;
  const { receiverEmail, amount } = req.body;

  const findUser = "SELECT id FROM users WHERE email = ?";

  db.query(findUser, [receiverEmail], (err, result) => {

    if (err) return res.status(500).send(err);

    if (result.length === 0)
      return res.status(404).send({ message: "Receiver not found" });

    const receiverId = result[0].id;

    db.query(
      "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
      [amount, senderId]
    );

    db.query(
      "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
      [amount, receiverId]
    );

    db.query(
      "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
      [senderId, receiverId, amount]
    );

    res.send({ message: "Gift sent successfully ❤️" });

  });
});


// =====================================================
// 🎁 NEW FEATURE — CREATE GIFT FOR ANY EMAIL
// =====================================================
app.post('/create-gift', authenticateToken, (req, res) => {

  const senderId = req.user.id;
  const { receiverEmail, amount, distributionType } = req.body;

  const giftCode = Math.random().toString(36).substring(2,10);

  // 1️⃣ CHECK BALANCE FIRST
  db.query(
    "SELECT balance FROM wallets WHERE user_id = ?",
    [senderId],
    (err, result) => {

      if (err) return res.status(500).send(err);

      const balance = result[0].balance;

      if (balance < amount) {
        return res.status(400).send({
          message: "Insufficient balance"
        });
      }

      // 2️⃣ DEDUCT MONEY
      db.query(
        "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
        [amount, senderId]
      );

      // 3️⃣ INSERT TRANSACTION (SENT GIFT)

db.query(
  "SELECT id FROM users WHERE email = ?",
  [receiverEmail],
  (err, userResult) => {

    let receiverId = null;

    if (userResult.length > 0) {
      receiverId = userResult[0].id;
    }

    db.query(
      "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
      [senderId, receiverId, -amount]
    );

  }
);

      // 4️⃣ CREATE GIFT RECORD
      db.query(
        `INSERT INTO gifts 
        (gift_code, sender_id, receiver_email, amount, distribution_type)
        VALUES (?, ?, ?, ?, ?)`,
        [giftCode, senderId, receiverEmail, amount, distributionType]
      );

      // 5️⃣ SEND EMAIL
      const giftLink = `https://lucklove-backend.onrender.com/gift/${giftCode}`;

      const mailOptions = {
        from: `"LuckLove 🎁" <${process.env.EMAIL_USER}>`,
        to: receiverEmail,
        subject: '🎁 You received a LuckLove Gift!',
        html: `
          <h2>LuckLove Gift 🎁</h2>  
          <p>You received <b>₹${amount}</b></p>
          <p>Click below to open your gift:</p>
          <a href="${giftLink}">${giftLink}</a>
        `
      };

      transporter.sendMail(mailOptions, (error, info) => {

  if (error) {
    console.log("Email error:", error);
  } 
  else {
    console.log("Email sent:", info.response);
  }

});

      res.send({
        message: "Gift created successfully",
        giftCode: giftCode
      });

    }
  );
});

// =====================================================
// 🎁 CLAIM GIFT
// =====================================================
app.post('/claim-gift', authenticateToken, (req,res)=>{

  const { giftCode } = req.body;
  const userId = req.user.id;

  const sql = "SELECT * FROM gifts WHERE gift_code = ?";

  db.query(sql,[giftCode],(err,result)=>{

    if(err) return res.status(500).send(err);

    if(result.length === 0)
      return res.status(404).send({message:"Gift not found"});

    const gift = result[0];

    if(gift.status === "claimed")
      return res.send({message:"Gift already claimed"});

    // add money to receiver wallet
db.query(
  "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
  [gift.amount,userId]
);

// record transaction
db.query(
  "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
  [gift.sender_id, userId, gift.amount]
);

// mark gift claimed
db.query(
  "UPDATE gifts SET status='claimed' WHERE gift_code=?",
  [giftCode]
);

    res.send({message:"Gift claimed 🎉"});

  });

});


// ============================
// 🎁 SEND GIFT + EMAIL
// ============================
app.post('/send-gift', authenticateToken, (req, res) => {

  const senderId = req.user.id;
  const { receiverEmail, amount } = req.body;

  const findUser = "SELECT id FROM users WHERE email = ?";

  db.query(findUser, [receiverEmail], (err, result) => {

    if (err) return res.status(500).send(err);

    if (result.length === 0)
      return res.status(404).send({ message: "Receiver not found" });

    const receiverId = result[0].id;

    db.query(
      "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
      [amount, senderId]
    );

    db.query(
      "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
      [amount, receiverId]
    );

    db.query(
      "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
      [senderId, receiverId, amount]
    );

    const mailOptions = {
      from: `"LuckLove 🎁" <${process.env.EMAIL_USER}>`,
      to: receiverEmail,
      subject: '🎁 You received a gift!',
      html: `
        <h2>LuckLove Gift Received 🎁</h2>
        <p>You have received <b>₹${amount}</b> gift.</p>
        <p>Open the LuckLove app to check your wallet.</p>
        <br/>
        <p>Thank you for using LuckLove ❤️</p>
      `
    };

    transporter.sendMail(mailOptions, function(error, info){
      if (error) {
        console.log("Email error:", error);
      } else {
        console.log("Email sent:", info.response);
      }
    });

    res.send({ message: "Gift sent successfully ❤️" });

  });
});

// ============================
// 📜 TRANSACTIONS
// ============================
app.get('/transactions', authenticateToken, (req, res) => {

  const userId = req.user.id;

  const sql = `
    SELECT t.*, 
           u1.email AS sender_email,
           u2.email AS receiver_email
    FROM transactions t
    LEFT JOIN users u1 ON t.sender_id = u1.id
    LEFT JOIN users u2 ON t.receiver_id = u2.id
    WHERE sender_id = ? OR receiver_id = ?
    ORDER BY t.created_at DESC
  `;

  db.query(sql, [userId, userId], (err, result) => {
    if (err) return res.status(500).send(err);
    res.send(result);
  });
});

// ============================
// 🎁 OPEN GIFT LINK FROM EMAIL
// ============================
app.get('/gift/:code', (req, res) => {

  const giftCode = req.params.code;

  const sql = "SELECT * FROM gifts WHERE gift_code = ?";

  db.query(sql, [giftCode], (err, result) => {

    if (err) return res.send("Server error");

    if (result.length === 0) {
      return res.send("<h2>Gift not found</h2>");
    }

    const gift = result[0];

    if (gift.status === "claimed") {
      return res.send("<h2>This gift was already opened 🎁</h2>");
    }

    res.send(`
      <html>
      <head>
        <title>LuckLove Gift</title>
      </head>
      <body style="font-family:Arial;text-align:center;padding:40px;">
        <h1>🎁 LuckLove Gift</h1>
        <h2>You received ₹${gift.amount}</h2>
        <p>Open the LuckLove app to claim your gift.</p>
      </body>
      </html>
    `);

  });

});

// ============================
// TEST ROUTE
// ============================
app.get('/', (req, res) => {
  res.send('Backend running');
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});