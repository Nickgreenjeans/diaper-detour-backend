import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertReviewSchema, insertChangingStationSchema } from "./schema";
import { z } from "zod";
import polyline from "polyline";

export async function registerRoutes(app: Express): Promise<Server> {
  // Apple MapKit token endpoint
  app.get("/api/apple-maps-token", (req, res) => {
    // In production, generate JWT token for Apple MapKit
    // For demo, return empty (MapKit will fall back to demo mode)
    const token = process.env.APPLE_MAPS_TOKEN || "";
    res.type('text/plain').send(token);
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

      const apiKey = process.env.OPENROUTESERVICE_API_KEY;
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
