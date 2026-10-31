# OmniLearn - Multimodal Study Assistant 🎓

An autonomous multimodal AI workspace that synthesizes information scattered across PDF readings, recorded lecture audio, and whiteboard photos into unified study guides, practice quizzes, and an interactive 3D Knowledge Hub.

---

## 🚀 Key Features

1. **Multimodal Media Ingestion**:
   - Upload and process documents (`.pdf`), lecture audio recordings (`.mp3`, `.wav`), and whiteboard photos (`.png`, `.jpg`).
   - Built-in Voice Audio Recorder to dictate study notes and lecture clips directly from the browser.
2. **Gemini 3.8 Flash Multimodal Synthesis**:
   - Cross-references what was said in the audio with what was written in the textbook and drawn on the whiteboard.
   - Explicit inline source citations (`[Backpropagation_Foundations.pdf]`, `[Lecture_04_Optimization_Notes.mp3]`).
   - Generates structured exam study guides and interactive practice quizzes with immediate grading.
3. **Interactive 3D Knowledge Hub (Three.js)**:
   - Procedural 8-component Holographic Neural Core with ACESFilmic PBR studio lighting and exponential damping camera.
   - Procedural 3D Media Nodes for each file type with orbital positions, laser connections, and raycast inspection.
   - Ergonomic collapsible bottom control dock (camera presets, exploded separation slider, spin rate, and filter).
4. **Authentication & Data Storage**:
   - JWT authentication with bcrypt password hashing and Zod schema validations.
   - Google sign-in through Firebase Authentication; the backend verifies Firebase ID tokens before issuing API JWTs.
   - Full Mongoose data models for `User` and `Workspace`.
   - Local development can use a file-backed fallback store; production requires MongoDB Atlas.

---

## 🛠 Tech Stack

- **Frontend**: React 19, Vite, React Router v7, Tailwind CSS, Axios, Lucide Icons, Three.js
- **Backend**: Node.js, Express.js, Multer (multipart uploads), Zod (request validation), JWT, bcryptjs, Mongoose
- **AI Engine**: Google Gemini API (`@google/genai`) with `gemini-3.8-flash`

---

## 💻 Local Setup & Execution

1. **Clone & Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file or configure via AI Studio Secrets:
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   JWT_SECRET="your-jwt-secret-key"
   MONGO_URI="" # Optional locally; required in production
   BLOB_READ_WRITE_TOKEN="your-vercel-blob-token"
   FIREBASE_SERVICE_ACCOUNT='{"project_id":"...","client_email":"...","private_key":"..."}'
   PORT=3000
   ```

3. **Start the Application**:
   ```bash
   npm run dev
   ```
   The application runs on `http://localhost:3000`.

---

## 🚢 Deployment Guide

### 1. Database: MongoDB Atlas
1. Create a free M0 cluster on [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a database user and whitelist network access (`0.0.0.0/0`).
3. Copy your connection string into `MONGO_URI`.

### Vercel deployment
1. Import the repository into Vercel and select Node.js **24.x** in Project Settings; `package.json` requires Node `>=24.12.0`.
2. Set the project root to `./` and build command to `npm run build`; `vercel.json` routes API requests to the Express function and React Router paths to the SPA entry point.
3. Configure `GEMINI_API_KEY`, a newly generated `JWT_SECRET`, `MONGO_URI`, `BLOB_READ_WRITE_TOKEN`, and `FIREBASE_SERVICE_ACCOUNT` as Vercel environment variables; never reuse the JWT secret previously committed to the repository.
4. Create and connect a **public** Vercel Blob store for file previews; browser uploads go directly to Blob, while the API verifies metadata and stores it in MongoDB.
5. Restrict MongoDB Atlas network access to the deployment’s trusted egress rather than allowing all IP addresses.

The Firebase web configuration is public client configuration, and [firestore.rules](./firestore.rules) denies all unmatched reads and writes while restricting profile/workspace access to the signed-in owner. Firebase remains in use for Google sign-in and Firestore profile synchronization; MongoDB stores application accounts and workspaces, and the backend verifies Firebase ID tokens before issuing its API JWT.

The configured Gemini model IDs, including `gemini-3.8-flash`, are listed in the [Gemini API model catalog](https://ai.google.dev/gemini-api/docs/models).
