import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertReviewSchema, insertChangingStationSchema } from "@shared/schema";
import { z } from "zod";
import polyline from "polyline";

export async function registerRoutes(app: Express): Promise<Server> {
  // Apple MapKit token endpoint (replaces Google Maps)
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

  // Get reviews for a station (handles both numeric IDs and Google Place IDs)
  app.get("/api/changing-stations/:id/reviews", async (req, res) => {
    try {
      const stationId = req.params.id;
      
      // Check if this is a Google Places ID (starts with 'google_')
      if (stationId.startsWith('google_')) {
        // For Google Places, return empty array initially - these are potential locations
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

  // Create a new review
  app.post("/api/reviews", async (req, res) => {
    try {
      const validatedData = insertReviewSchema.parse(req.body);
      const review = await storage.createReview(validatedData);
      res.status(201).json(review);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid review data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create review" });
    }
  });

  // Search Google Places for potential changing station locations
  app.get("/api/places/search", async (req, res) => {
    try {
      const { lat, lng, radius = 2000, type = 'restaurant' } = req.query;
      
      if (!lat || !lng) {
        return res.status(400).json({ message: "Latitude and longitude are required" });
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "Google Maps API key not configured" });
      }

      // Search for places that commonly have changing stations
      const searchTypes = ['restaurant', 'shopping_mall', 'store', 'cafe', 'supermarket', 'department_store'];
      const selectedType = searchTypes.includes(type as string) ? type : 'restaurant';
      
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json?` +
        `location=${lat},${lng}&radius=${radius}&type=${selectedType}&` +
        `key=${apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Google Places API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Filter for establishments more likely to have changing stations
      const filtered = data.results?.filter((place: any) => {
        const hasGoodRating = place.rating >= 3.5;
        const name = place.name?.toLowerCase() || '';
        
        // Businesses guaranteed to have changing stations
        const guaranteedChains = [
          'target', 'walmart', 'loves', 'love\'s', 'panera', 'panera bread', 
          'buc-ee', 'buc-ees', 'kroger', 'meijer', 'chick-fil-a'
        ];
        
        const isGuaranteedChain = guaranteedChains.some(chain => name.includes(chain));
        
        // Other likely chains
        const isLikelyChain = name.includes('starbucks') || 
                            name.includes('mcdonald') ||
                            name.includes('whole foods') ||
                            place.types?.includes('shopping_mall');
        
        const hasHighPriceLevel = place.price_level >= 2;
        
        // Prioritize guaranteed chains, then other criteria
        return isGuaranteedChain || (hasGoodRating && (isLikelyChain || hasHighPriceLevel || place.types?.includes('shopping_mall')));
      }) || [];

      // Sort to prioritize guaranteed chains first
      filtered.sort((a: any, b: any) => {
        const aName = a.name?.toLowerCase() || '';
        const bName = b.name?.toLowerCase() || '';
        const guaranteedChains = [
          'target', 'walmart', 'loves', 'love\'s', 'panera', 'panera bread', 
          'buc-ee', 'buc-ees', 'kroger', 'meijer', 'chick-fil-a'
        ];
        
        const aIsGuaranteed = guaranteedChains.some(chain => aName.includes(chain));
        const bIsGuaranteed = guaranteedChains.some(chain => bName.includes(chain));
        
        if (aIsGuaranteed && !bIsGuaranteed) return -1;
        if (!aIsGuaranteed && bIsGuaranteed) return 1;
        return (b.rating || 0) - (a.rating || 0); // Then by rating
      });

      res.json({
        results: filtered.slice(0, 15), // Limit results
        status: data.status
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Create a new changing station from Google Places data
  app.post("/api/changing-stations/from-place", async (req, res) => {
    try {
      const { place, hasChangingStation = true } = req.body;
      
      if (!place || !place.place_id) {
        return res.status(400).json({ message: "Valid Google Place data is required" });
      }

      const stationData = {
        businessName: place.name,
        address: place.vicinity || place.formatted_address || "Address not available",
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng,
        isAccessible: null, // To be verified by users
        isPrivate: false, // Assume public unless specified
        hasSupplies: null, // To be verified by users
        businessHours: place.opening_hours?.open_now !== undefined 
          ? (place.opening_hours.open_now ? "Open" : "Closed") 
          : null,
        isOpen: place.opening_hours?.open_now || null
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

  // US-only Google Places search for changing stations
  app.get("/api/places/nationwide", async (req, res) => {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 16;
      const query = req.query.q as string;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({ message: "Valid latitude and longitude are required" });
      }

      // Use storage's US-only Google Places integration
      const places = await storage.searchPlacesNearby(lat, lng, radius, query);
      
      // Transform Google Places data to match our changing station format
      const transformedPlaces = places.map(place => ({
        id: `google_${place.place_id}`,
        businessName: place.name,
        address: place.vicinity || place.formatted_address || "Address not available",
        latitude: place.geometry.location.lat,
        longitude: place.geometry.location.lng,
        rating: place.rating || 0,
        totalReviews: 0, // These are potential locations, not verified changing stations
        isVerified: false,
        isAccessible: null,
        hasChangingStation: null, // Unknown until verified by users
        hasSupplies: null,
        isPrivate: false,
        businessHours: place.opening_hours?.open_now !== undefined 
          ? (place.opening_hours.open_now ? "Open" : "Closed") 
          : null,
        isOpen: place.opening_hours?.open_now || null,
        source: "google_places",
        placeId: place.place_id
      }));
      
      res.json({
        results: transformedPlaces,
        location: { lat, lng },
        radius: `${radius}km`,
        totalResults: transformedPlaces.length,
        coverage: "US-only"
      });
    } catch (error) {
      console.error("US places search error:", error);
      res.status(500).json({ message: "Failed to search US places" });
    }
  });

  app.get('/api/apple-maps-token', (req, res) => {
    res.json('');
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
      
    } catch (error) {
      console.error('OpenRouteService error:', error);
      res.status(500).json({ error: 'Routing service unavailable', details: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
