// Env vars harus di-set sebelum modul apapun yang baca process.env di-load
process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.BACKEND_URL = 'http://localhost:5000';
process.env.NODE_ENV = 'test';