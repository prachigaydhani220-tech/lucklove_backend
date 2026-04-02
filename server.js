const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

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

// ============================
// 🎯 RANDOM SPLIT FUNCTION
// ============================

function randomSplit(total, count){

  let parts = [];

  let remaining = total;

  for(let i=0; i<count-1; i++){

    let max =
    remaining - (count - i - 1);

    let val =
    Math.floor(
      Math.random() * max
    ) + 1;

    parts.push(val);

    remaining -= val;

  }

  parts.push(remaining);

  return parts;

}

// =====================================================
// 🎁 NEW FEATURE — CREATE GIFT FOR ANY EMAIL
// =====================================================
app.post('/create-gift', authenticateToken, (req, res) => {

  const senderId = req.user.id;

  const {
    receiverEmails,
    amount,
    distributionType,
    receiverCount
  } = req.body;

  // SPLIT EMAILS
  const emailList =
  receiverEmails.split(",");

  let splitAmounts = [];

  // ============================
  // SPLIT LOGIC
  // ============================

  if(
  distributionType === "Random" ||
  distributionType === "Game-Random"
){

  splitAmounts =
  randomSplit(amount, receiverCount);

}
else if(
  distributionType === "Equal" ||
  distributionType === "Game-Equal"
){

  let each =
  Math.floor(amount / receiverCount);

  splitAmounts =
  Array(receiverCount).fill(each);

}

  // ============================
  // CHECK BALANCE
  // ============================

  db.query(
    "SELECT balance FROM wallets WHERE user_id = ?",
    [senderId],
    (err, result) => {

      if (err) return res.status(500).send(err);

      const balance =
      result[0].balance;

      if(balance < amount){

        return res.status(400).send({
          message:"Insufficient balance"
        });

      }

      // ============================
      // DEDUCT MONEY ONCE
      // ============================

      db.query(
        "UPDATE wallets SET balance = balance - ? WHERE user_id = ?",
        [amount, senderId]
      );

      // ============================
      // CREATE GIFTS
      // ============================

      emailList.forEach((email,index)=>{

        const giftCode =
        Math.random()
        .toString(36)
        .substring(2,10);

        const finalAmount =
        splitAmounts[index];

        // INSERT GIFT

        db.query(
  `INSERT INTO gifts
  (gift_code,
   sender_id,
   receiver_email,
   amount,
   distribution_type,
   remaining_amount,
   status)

   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [
    giftCode,
    senderId,
    email,

    finalAmount,   // ⭐ VERY IMPORTANT
    distributionType,

    finalAmount,   // ⭐ remaining = split amount

    "pending"
  ]
);

        // SAVE TRANSACTION

        db.query(
          "SELECT id FROM users WHERE email = ?",
          [email],
          (err,userResult)=>{

            if(userResult.length > 0){

              const receiverId =
              userResult[0].id;

              db.query(
                "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
                [
                  senderId,
                  receiverId,
                  -finalAmount
                ]
              );

              // NOTIFICATION

              db.query(
                `INSERT INTO notifications
                (user_id,title,message)
                VALUES (?, ?, ?)`,
                [
                  receiverId,
                  "🎁 New Gift Received",
                  `You received a gift 🎁`
                ]
              );

              // EMAIL

              resend.emails.send({
                from:'LuckLove <buildality@aiaj.tech>',
                to: email,
                subject:'🎁 You received a LuckLove Gift!',
                html:`
                  <h2>LuckLove Gift 🎁</h2>
                  <p>You received a gift!</p>
                `
              });

            }

          }
        );

      });

      res.send({
        message:"Gift created successfully"
      });

    }

  );

});

// ============================
// 🔔 GET NOTIFICATIONS
// ============================

app.get('/notifications', authenticateToken, (req, res) => {

  const userId = req.user.id;

  const sql = `
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  db.query(sql, [userId], (err, result) => {

    if (err) return res.status(500).send(err);

    res.send(result);

  });

});

// ============================
// MARK AS READ
// ============================

app.post('/notifications/read', authenticateToken, (req,res)=>{

  const { id } = req.body;

  db.query(
    "UPDATE notifications SET is_read = TRUE WHERE id = ?",
    [id]
  );

  res.send({ message:"Marked read" });

});

// =====================================================
// 🎁 CLAIM GIFT (FINAL FIXED VERSION)
// =====================================================

app.post('/claim-gift', authenticateToken, (req,res)=>{

  const { giftCode } = req.body;
  const userId = req.user.id;

  const sql =
"SELECT * FROM gifts WHERE gift_code = ? AND status != 'claimed'";

  db.query(sql,[giftCode],(err,result)=>{

    if(err)
      return res.status(500).send(err);

    if(result.length === 0)
      return res.status(404).send({
        message:"Gift not found"
      });

    const gift = result[0];

    // already claimed check
    if(gift.status === "claimed")
      return res.send({
        message:"Gift already claimed"
      });

    // ⭐ VERY IMPORTANT
    // use remaining_amount not full amount

    const winAmount =
    parseInt(gift.remaining_amount);

    // ==========================
    // ADD MONEY TO WALLET
    // ==========================

    db.query(
      "UPDATE wallets SET balance = balance + ? WHERE user_id = ?",
      [winAmount, userId]
    );

    // ==========================
    // SAVE TRANSACTION
    // ==========================

    db.query(
      "INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)",
      [
        gift.sender_id,
        userId,
        winAmount
      ]
    );

    // ==========================
    // MARK GIFT CLAIMED
    // ==========================

    db.query(
      "UPDATE gifts SET status='claimed' WHERE gift_code=?",
      [giftCode]
    );

    // ==========================
    // RESPONSE
    // ==========================

    res.send({
      message:"Gift claimed 🎉",
      winAmount: winAmount
    });

  });

});


// ============================
// 🎁 SEND GIFT + EMAIL
// ============================
app.post('/send-gift', authenticateToken, async (req, res) => {

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

  resend.emails.send({
  from: 'LuckLove <buildality@aiaj.tech>',
  to: receiverEmail,
  subject: '🎁 You received a gift!',
  html: `
    <h2>LuckLove Gift Received 🎁</h2>
    <p>You have received <b>₹${amount}</b> gift.</p>
    <p>Open the LuckLove app to check your wallet.</p>
    <br/>
    <p>Thank you for using LuckLove ❤️</p>
  `
})
.then(() => {
  console.log("Email sent successfully");
})
.catch((error) => {
  console.log("Email error:", error);
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
    SELECT 
      t.id,
      t.sender_id,
      t.receiver_id,
      t.amount,
      t.created_at,

      sender.email AS sender_email,
      receiver.email AS receiver_email

    FROM transactions t

    LEFT JOIN users sender
      ON sender.id = t.sender_id

    LEFT JOIN users receiver
      ON receiver.id = t.receiver_id

    WHERE 
      t.sender_id = ?
      OR t.receiver_id = ?

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
// 🎁 GET RECEIVED GIFTS
// ============================

app.get('/received-gifts', authenticateToken, (req, res) => {

  const userEmail = req.user.email;

  const sql = `
   SELECT 
g.gift_code,
g.amount,
g.remaining_amount,
g.status,
g.created_at,
g.distribution_type,
u.email AS sender_email

    FROM gifts g

    LEFT JOIN users u 
      ON g.sender_id = u.id

    WHERE g.receiver_email = ?

    ORDER BY g.created_at DESC
  `;

  db.query(sql, [userEmail], (err, result) => {

    if (err) return res.status(500).send(err);

    res.send(result);

  });

});

// ============================
// MARK ALL AS READ
// ============================

app.post('/notifications/read-all',
authenticateToken,
(req,res)=>{

  const userId = req.user.id;

  db.query(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ?",
    [userId]
  );

  res.send({
    message:"All notifications marked read"
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