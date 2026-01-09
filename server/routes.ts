import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertReviewSchema, insertChangingStationSchema } from "./schema";
import { z } from "zod";
import polyline from "polyline";
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export async function registerRoutes(app: Express): Promise<Server> {
  // Apple MapKit token endpoint
  app.get("/api/apple-maps-token", (req, res) => {
    // In production, generate JWT token for Apple MapKit
    // For demo, return empty (MapKit will fall back to demo mode)
    const token = process.env.APPLE_MAPS_TOKEN || "";
    res.type('text/plain').send(token);
  });

// User authentication routes
app.post("/api/auth/apple", async (req, res) => {
  try {
    const { identityToken, appleUserId, email, firstName } = req.body;
    
    if (!identityToken || !appleUserId) {
      return res.status(400).json({ message: "Identity token and Apple User ID are required" });
    }
    
    // Validate the identity token with Apple's public keys
    try {
      // Create JWKS client to fetch Apple's public keys
      const client = jwksClient({
        jwksUri: 'https://appleid.apple.com/auth/keys',
        cache: true,
        rateLimit: true,
      });
      
      // Decode token to get the key ID
      const decodedToken = jwt.decode(identityToken, { complete: true });
      
      if (!decodedToken || !decodedToken.header.kid) {
        return res.status(401).json({ message: "Invalid token format" });
      }
      
      // Get the signing key from Apple
      const key = await client.getSigningKey(decodedToken.header.kid);
      const publicKey = key.getPublicKey();
      
      // Verify the token
      const verifiedToken = jwt.verify(identityToken, publicKey, {
        audience: 'com.diaperdetour.mobile',
        issuer: 'https://appleid.apple.com',
      });
      
      console.log('Apple token validated successfully for user:', appleUserId);
      
      // Verify the subject matches
      if (verifiedToken.sub !== appleUserId) {
        return res.status(401).json({ message: "Token user ID mismatch" });
      }
      
    } catch (tokenError) {
      console.error('Apple token validation failed:', tokenError);
      return res.status(401).json({ message: "Invalid Apple Sign In token" });
    }
    
    // Token is valid, now check if user exists
    const existingUser = await storage.getUserByAppleId(appleUserId);
    
    if (existingUser) {
      return res.json(existingUser);
    }
    
    // Create new user
    const newUser = await storage.createUser({
      appleUserId,
      email: email || null,
      firstName: firstName || null,
    });
    
    res.status(201).json(newUser);
  } catch (error) {
    console.error('Error with Apple authentication:', error);
    res.status(500).json({ message: "Failed to authenticate" });
  }
});

// Update user's push token
app.put("/api/users/:appleUserId/push-token", async (req, res) => {
  try {
    const { appleUserId } = req.params;
    const { expoPushToken } = req.body;
    
    const updatedUser = await storage.updateUserPushToken(appleUserId, expoPushToken);
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating push token:', error);
    res.status(500).json({ message: "Failed to update push token" });
  }
});

  // Log user navigation (when they tap directions)
app.post("/api/user-navigations", async (req, res) => {
  try {
    const { userId, stationId, stationName } = req.body;
    
    if (!userId || !stationId || !stationName) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    
    // Cancel any pending notifications for this user
    await storage.cancelPendingNavigations(userId);
    
    // Create new navigation record with notification scheduled for 20 min later
    const scheduledTime = new Date();
    scheduledTime.setMinutes(scheduledTime.getMinutes() + 20);
    
    const navigation = await storage.createNavigation({
      userId,
      stationId,
      stationName,
      navigatedAt: new Date(),
      notificationScheduled: scheduledTime,
      notificationSent: false,
      cancelled: false,
      reviewCompleted: false,
    });
    
    console.log('Navigation logged:', navigation.id, 'for user:', userId, 'station:', stationName);
    
    res.status(201).json(navigation);
  } catch (error) {
    console.error('Error logging navigation:', error);
    res.status(500).json({ message: "Failed to log navigation" });
  }
});
  
  // Get all changing stations
  app.get("/api/changing-stations", async (req, res) => {
    try {
      const stations = await storage.getChangingStations();
      res.json(stations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch changing stations" });
    }
  });

  // Search changing stations (must be before :id route)
  app.get("/api/changing-stations/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ message: "Search query is required" });
      }

      const stations = await storage.searchChangingStations(query);
      res.json(stations);
    } catch (error) {
      res.status(500).json({ message: "Failed to search changing stations" });
    }
  });

  // Create a new changing station (manual add by user)
app.post("/api/changing-stations", async (req, res) => {
  try {
    const stationData = req.body;
    
    // Validate required fields
    if (!stationData.businessName || !stationData.address || !stationData.latitude || !stationData.longitude) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    
    const newStation = await storage.createChangingStation(stationData);
    res.status(201).json(newStation);
  } catch (error) {
    console.error('Error creating changing station:', error);
    res.status(500).json({ message: "Failed to create changing station" });
  }
});
  
  // Get nearby changing stations (must be before :id route)  
  app.get("/api/changing-stations/nearby", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 10;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Valid latitude and longitude are required" });
      }

      const stations = await storage.getChangingStationsNearby(lat, lng, radius);
      res.json(stations);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch nearby changing stations" });
    }
  });

  // Get changing station by ID
  app.get("/api/changing-stations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid station ID" });
      }

      const station = await storage.getChangingStation(id);
      if (!station) {
        return res.status(404).json({ message: "Changing station not found" });
      }

      res.json(station);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch changing station" });
    }
  });

  // Get reviews for a station (handles both numeric IDs and Foursquare IDs)
  app.get("/api/changing-stations/:id/reviews", async (req, res) => {
    try {
      const stationId = req.params.id;
      
      // Check if this is a Foursquare ID (starts with 'fsq_')
      if (stationId.startsWith('fsq_')) {
        // For Foursquare places, return empty array initially - these are potential locations
        // Users need to add changing station reviews to verify them
        res.json([]);
        return;
      }
      
      // Handle numeric station IDs
      const numericId = parseInt(stationId);
      if (isNaN(numericId)) {
        return res.status(400).json({ message: "Invalid station ID" });
      }

      const reviews = await storage.getReviewsForStation(numericId);
      res.json(reviews);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch reviews" });
    }
  });

  // NEW: Create a new review with auto-station creation
  app.post("/api/reviews", async (req, res) => {
    try {
      const { placeData, ...reviewData } = req.body;
      
      // If placeData is provided (from Foursquare), create/find station first
      if (placeData) {
        const station = await storage.findOrCreateStationFromPlace(placeData);
        reviewData.stationId = station.id;
      }
      
      const validatedData = insertReviewSchema.parse(reviewData);
      const review = await storage.createReview(validatedData);
      res.status(201).json(review);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid review data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create review" });
    }
  });

  // Report a review
app.post("/api/reviews/:id/report", async (req, res) => {
  try {
    const reviewId = parseInt(req.params.id);
    const { reason } = req.body;
    
    if (isNaN(reviewId)) {
      return res.status(400).json({ message: "Invalid review ID" });
    }
    
    // Get the review details
    const review = await storage.getReviewsForStation(reviewId);
    
    // Log the report (you can see this in Render logs)
    console.log('REVIEW REPORTED:', {
      reviewId,
      reason: reason || 'No reason provided',
      timestamp: new Date().toISOString()
    });
    
    // TODO: Send email to diaper detour email
    // For now, just return success
    
    res.status(200).json({ message: "Review reported successfully" });
  } catch (error) {
    console.error('Error reporting review:', error);
    res.status(500).json({ message: "Failed to report review" });
  }
});
  
  // Foursquare Places search for changing stations
  app.get("/api/foursquare/nearby", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 16;
      const query = req.query.q as string;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Valid latitude and longitude are required" });
      }

      // Use storage's Foursquare integration
      const places = await storage.searchPlacesNearby(lat, lng, radius, query);

      console.log('Raw places from storage:', places.length);
      console.log('First place structure:', JSON.stringify(places[0], null, 2));
      
      // Transform Foursquare data to match our changing station format
      const transformedPlaces = places.map(place => ({
    id: `fsq_${place.fsq_id}`,
    fsq_id: place.fsq_id,
        businessName: place.name,
        address: place.location?.formatted_address || place.location?.address || "Address not available",
        latitude: place.latitude,
        longitude: place.longitude,
        categories: place.categories,
        distance: place.distance,
        rating: 0,
        totalReviews: 0, // These are potential locations, not verified changing stations
        isVerified: false,
        isAccessible: null,
        hasChangingStation: null, // Unknown until verified by users
        hasSupplies: null,
        isPrivate: false,
        isGuaranteedChain: place.isGuaranteedChain,
        changingStationScore: place.changingStationScore,
        source: "foursquare"
      }));
      
      res.json({
        results: transformedPlaces,
        location: { lat, lng },
        radius: `${radius}km`,
        totalResults: transformedPlaces.length
      });
    } catch (error) {
      console.error("Foursquare search error:", error);
      res.status(500).json({ message: "Failed to search Foursquare places" });
    }
  });

  // Create a new changing station from Foursquare data
  app.post("/api/changing-stations/from-foursquare", async (req, res) => {
    try {
      const { place } = req.body;
      
      if (!place || !place.fsq_id) {
        return res.status(400).json({ message: "Valid Foursquare Place data is required" });
      }

      const stationData = {
        businessName: place.name,
        address: place.location?.formatted_address || place.location?.address || "Address not available",
        latitude: place.geocodes?.main?.latitude || place.geocodes?.roof?.latitude,
        longitude: place.geocodes?.main?.longitude || place.geocodes?.roof?.longitude,
        isAccessible: null, // To be verified by users
        isPrivate: false, // Assume public unless specified
        hasSupplies: null, // To be verified by users
        businessHours: null,
        isOpen: null
      };

      const validatedData = insertChangingStationSchema.parse(stationData);
      const station = await storage.createChangingStation(validatedData);
      
      res.status(201).json(station);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid station data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create changing station" });
    }
  });

  // OpenRouteService proxy endpoint for exact roadway routing
  app.post('/api/directions', async (req, res) => {
    try {
      const { origin, destination } = req.body;
      
      console.log('Directions request:', { origin, destination });
      
      if (!origin || !destination) {
        return res.status(400).json({ error: 'Origin and destination coordinates required' });
      }

      const apiKey = process.env.OPENROUTE_API_KEY;
      console.log('API Key exists:', !!apiKey);
      
      if (!apiKey) {
        console.error('No OpenRouteService API key found');
        return res.status(500).json({ error: 'API key not configured' });
      }

      const requestBody = {
        coordinates: [
          [origin.longitude, origin.latitude],
          [destination.longitude, destination.latitude]
        ],
        format: 'geojson',
        instructions: false
      };
      
      console.log('OpenRouteService request body:', JSON.stringify(requestBody, null, 2));

      const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
        method: 'POST',
        headers: {
          'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
          'Authorization': apiKey,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(requestBody)
      });

      console.log('OpenRouteService response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenRouteService error response:', errorText);
        throw new Error(`OpenRouteService API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('OpenRouteService response data received');
      
      // OpenRouteService returns routes array, not features
      if (data.routes && data.routes[0]) {
        const route = data.routes[0];
        const summary = route.summary;
        const encodedGeometry = route.geometry;
        
        console.log('Decoding route geometry...');
        
        // Decode the polyline geometry to get actual route coordinates
        const decodedCoordinates = polyline.decode(encodedGeometry);
        
        // Convert from [latitude, longitude] to {latitude, longitude} format
        const routeCoordinates = decodedCoordinates.map((coord: number[]) => ({
          latitude: coord[0],
          longitude: coord[1]
        }));
        
        console.log('Route found with', routeCoordinates.length, 'coordinate points from actual road geometry');
        
        // Extract distance and duration from summary
        const distanceKm = summary.distance / 1000;
        const distanceMiles = distanceKm * 0.621371;
        const durationMinutes = Math.round(summary.duration / 60);
        
        const result = {
          coordinates: routeCoordinates,
          distance: `${distanceMiles.toFixed(1)} mi`,
          duration: `${durationMinutes} min`,
          isEstimate: false,
          summary: 'Actual route via roadways'
        };
        
        console.log('Returning route result:', { 
          coordinateCount: result.coordinates.length,
          distance: result.distance,
          duration: result.duration 
        });
        
        res.json(result);
      } else {
        console.error('No route found in response');
        res.status(500).json({ error: 'No route found' });
      }
      
    } catch (error: any) {
      console.error('OpenRouteService error:', error);
      res.status(500).json({ error: 'Routing service unavailable', details: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
