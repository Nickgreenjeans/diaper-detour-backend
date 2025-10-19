# Diaper Detour - Backend API

Backend API for the Diaper Detour mobile app.

## Setup

### Environment Variables
Copy `.env.example` to `.env` and fill in your API keys.

### Install Dependencies
```bash
npm install
```

### Push Database Schema
```bash
npm run db:push
```

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## API Endpoints

- `GET /api/changing-stations` - Get all stations
- `GET /api/changing-stations/:id/reviews` - Get reviews for a station
- `POST /api/reviews` - Submit a new review
- `PATCH /api/changing-stations/:id/status` - Update station status
- `POST /api/directions` - Get directions between two points

## Deployment

Deployed on Render.com with Neon PostgreSQL database.
```

