
---

## Getting Started (Run Locally)

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)
- MongoDB (local installation or MongoDB Atlas account)

---

### 1. Clone the repository

```bash
git clone https://github.com/your-username/File-Transfer.git
cd File-Transfer-Application--master
```

---

### 2. Backend Setup

```bash
cd backend
npm install
```

- Create a `.env` file in the `backend` folder with the following content:
  ```
  MONGO_URI=your_mongodb_connection_string
  JWT_SECRET=your_jwt_secret
  PORT=5000
  ```

- Start the backend server:
  ```bash
  npm start
  ```
  The backend will run on [http://localhost:5000](http://localhost:5000)

---

### 3. Frontend Setup

Open a new terminal window and run:

```bash
cd frontend
npm install
npm start
```

The frontend will run on [http://localhost:3000](http://localhost:3000)

---

### 4. Usage

- Open your browser and go to [http://localhost:3000](http://localhost:3000)
- Register a new user, log in, and start transferring files!

---

