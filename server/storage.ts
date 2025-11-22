import { db } from './db';
import { eq, sql as drizzleSql, like, and } from 'drizzle-orm';
import { changingStations, reviews, type ChangingStation, type InsertChangingStation, type Review, type InsertReview } from "@shared/schema";

export interface IStorage {
  // Changing Stations
  getChangingStations(): Promise<ChangingStation[]>;
  getChangingStation(id: number): Promise<ChangingStation | undefined>;
  createChangingStation(station: InsertChangingStation): Promise<ChangingStation>;
  searchChangingStations(query: string): Promise<ChangingStation[]>;
  getChangingStationsNearby(lat: number, lng: number, radiusKm?: number): Promise<ChangingStation[]>;
  
  // Reviews
  getReviewsForStation(stationId: number): Promise<Review[]>;
  createReview(review: InsertReview): Promise<Review>;
  updateStationRating(stationId: number): Promise<void>;
  
  // Foursquare Integration
  searchPlacesNearby(lat: number, lng: number, radiusKm?: number, query?: string): Promise<any[]>;
  findOrCreateStationFromPlace(placeData: any): Promise<ChangingStation>;
}

export class MemStorage implements IStorage {
  private changingStations: Map<number, ChangingStation>;
  private reviews: Map<number, Review>;
  private currentStationId: number;
  private currentReviewId: number;

  // Define guaranteed chains that always have changing stations
  private guaranteedChains = [
    'Target', 'Walmart', 'Kroger', 'Meijer', 'Chick-fil-A', 
    'Panera Bread', "Love's Travel Stop", 'Pilot Flying J',
    "Buc-ee's", 'Barnes & Noble', 'Buy Buy Baby', 'Babies"R"Us',
    'Whole Foods Market', 'Wegmans', 'H-E-B', 'Publix',
    'Home Depot', "Lowe's"
  ];

  constructor() {
    this.changingStations = new Map();
    this.reviews = new Map();
    this.currentStationId = 1;
    this.currentReviewId = 1;
    
    // Initialize with minimal sample data for testing
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Sample data for Tennessee demonstration
    const sampleStations: InsertChangingStation[] = [
      {
        businessName: "McDonald's - Nashville West End",
        address: "2404 West End Ave, Nashville, TN 37203",
        latitude: 36.1513,
        longitude: -86.8025,
        isAccessible: true,
        isPrivate: false,
        hasSupplies: true,
        businessHours: '{"mon":"5:00AM-11:00PM","tue":"5:00AM-11:00PM","wed":"5:00AM-11:00PM","thu":"5:00AM-11:00PM","fri":"5:00AM-12:00AM","sat":"5:00AM-12:00AM","sun":"5:00AM-11:00PM"}',
        isOpen: true,
        isVerified: true
      },
      {
        businessName: "Target - Nashville Gallatin Pike",
        address: "2491 Gallatin Pike, Nashville, TN 37216",
        latitude: 36.1866,
        longitude: -86.7311,
        isAccessible: true,
        isPrivate: false,
        hasSupplies: true,
        businessHours: '{"mon":"8:00AM-10:00PM","tue":"8:00AM-10:00PM","wed":"8:00AM-10:00PM","thu":"8:00AM-10:00PM","fri":"8:00AM-10:00PM","sat":"8:00AM-10:00PM","sun":"8:00AM-9:00PM"}',
        isOpen: true,
        isVerified: true
        isGuaranteedChain: true
      }
    ];

    // Add sample stations to the map
    sampleStations.forEach(station => {
      const stationWithId: ChangingStation = {
        id: this.currentStationId++,
        businessName: station.businessName,
        address: station.address,
        latitude: station.latitude,
        longitude: station.longitude,
        isAccessible: station.isAccessible ?? null,
        isPrivate: station.isPrivate ?? null,
        hasSupplies: station.hasSupplies ?? null,
        businessHours: station.businessHours ?? null,
        isOpen: station.isOpen ?? null,
        isVerified: station.isVerified ?? null,
        averageRating: 0,
        reviewCount: 0,
        hasChangingStation: true,
        negativeReports: 0,
      };
      this.changingStations.set(stationWithId.id, stationWithId);
    });

    // Update average ratings for stations with reviews
    this.changingStations.forEach(station => {
      this.updateStationRating(station.id);
    });
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R * c; // Distance in kilometers
    return d;
  }

  private isGuaranteedChain(businessName: string): boolean {
    return this.guaranteedChains.some(chain => 
      businessName.toLowerCase().includes(chain.toLowerCase())
    );
  }

  async getChangingStations(): Promise<ChangingStation[]> {
    return Array.from(this.changingStations.values());
  }

  async getChangingStation(id: number): Promise<ChangingStation | undefined> {
    return this.changingStations.get(id);
  }

  async createChangingStation(station: InsertChangingStation): Promise<ChangingStation> {
    const newStation: ChangingStation = {
      id: this.currentStationId++,
      businessName: station.businessName,
      address: station.address,
      latitude: station.latitude,
      longitude: station.longitude,
      isAccessible: station.isAccessible ?? null,
      isPrivate: station.isPrivate ?? null,
      hasSupplies: station.hasSupplies ?? null,
      businessHours: station.businessHours ?? null,
      isOpen: station.isOpen ?? null,
      isVerified: station.isVerified ?? null,
      averageRating: 0,
      reviewCount: 0,
      hasChangingStation: true,
      negativeReports: 0,
    };
    
    this.changingStations.set(newStation.id, newStation);
    return newStation;
  }

  async searchChangingStations(query: string): Promise<ChangingStation[]> {
    const normalizedQuery = query.toLowerCase().trim();
    
    return Array.from(this.changingStations.values()).filter(station =>
      station.businessName.toLowerCase().includes(normalizedQuery) ||
      station.address.toLowerCase().includes(normalizedQuery)
    );
  }

  async getChangingStationsNearby(lat: number, lng: number, radiusKm: number = 16): Promise<ChangingStation[]> {
    return Array.from(this.changingStations.values())
      .filter(station => this.calculateDistance(lat, lng, station.latitude, station.longitude) <= radiusKm)
      .sort((a, b) => 
        this.calculateDistance(lat, lng, a.latitude, a.longitude) - 
        this.calculateDistance(lat, lng, b.latitude, b.longitude)
      );
  }

  async getReviewsForStation(stationId: number): Promise<Review[]> {
    return Array.from(this.reviews.values()).filter(review => review.stationId === stationId);
  }

  async createReview(review: InsertReview): Promise<Review> {
    const newReview: Review = {
      id: this.currentReviewId++,
      stationId: review.stationId,
      authorName: review.authorName,
      rating: review.rating,
      isAccessible: review.isAccessible ?? null,
      isPrivate: review.isPrivate ?? null,
      content: review.content ?? null,
      isCleanliness: review.isCleanliness ?? null,
      isWellStocked: review.isWellStocked ?? null,
      reportNoChangingStation: review.reportNoChangingStation ?? null,
      confirmHasChangingStation: review.confirmHasChangingStation ?? null,
      createdAt: new Date(),
    };
    
    this.reviews.set(newReview.id, newReview);
    await this.updateStationRating(newReview.stationId);
    
    return newReview;
  }

  async updateStationRating(stationId: number): Promise<void> {
    const station = this.changingStations.get(stationId);
    if (!station) return;

    const stationReviews = Array.from(this.reviews.values()).filter(review => review.stationId === stationId);
    
    if (stationReviews.length === 0) {
      station.averageRating = 0;
      station.reviewCount = 0;
      station.negativeReports = 0;
      return;
    }

    const totalRating = stationReviews.reduce((sum, review) => sum + review.rating, 0);
    station.averageRating = Math.round((totalRating / stationReviews.length) * 10) / 10;
    station.reviewCount = stationReviews.length;
    
    // Count negative reports (reviews that report no changing station)
    station.negativeReports = stationReviews.filter(review => review.reportNoChangingStation === true).length;
    
    // Update verification status based on reviews
if (stationReviews.length >= 1) {
  const positiveReviews = stationReviews.filter(review => review.confirmHasChangingStation === true).length;
  const negativeReviews = station.negativeReports;
  
  if (negativeReviews > positiveReviews) {
    station.hasChangingStation = false;
  } else if (positiveReviews > 0) {
    station.hasChangingStation = true;
    // Only mark as verified if it's NOT a guaranteed chain
    // Guaranteed chains stay marked as guaranteed even after verification
    if (!this.isGuaranteedChain(station.businessName)) {
      station.isVerified = true;
    }
  }
}

  // NEW: Find or create station from Foursquare place data
  async findOrCreateStationFromPlace(placeData: any): Promise<ChangingStation> {
  // Check if station already exists by searching for matching coordinates
  const existingStations = await this.getChangingStations();
  const existing = existingStations.find(station => 
    Math.abs(station.latitude - placeData.latitude) < 0.0001 &&
    Math.abs(station.longitude - placeData.longitude) < 0.0001
  );
  
  if (existing) {
    return existing;
  }
  
  // Check if this is a guaranteed chain
  const isGuaranteed = this.isGuaranteedChain(placeData.businessName);
  
  const stationData: InsertChangingStation = {
  businessName: placeData.businessName,
  address: placeData.address,
  latitude: placeData.latitude,
  longitude: placeData.longitude,
  isAccessible: null,
  isPrivate: false,
  hasSupplies: null,
  businessHours: placeData.businessHours || null,
  isOpen: placeData.isOpen || null,
  isVerified: false,
  isGuaranteedChain: isGuaranteed
};
  
  const newStation = await this.createChangingStation(stationData);
  
  // Add isGuaranteedChain property if it's a guaranteed chain
  // This ensures the frontend can identify it properly
  return {
    ...newStation,
    isGuaranteedChain: isGuaranteed
  } as ChangingStation;
}

  // Foursquare API integration
async searchPlacesNearby(lat: number, lng: number, radiusKm: number = 16, query?: string): Promise<any[]> {
  const foursquareApiKey = process.env.FOURSQUARE_API_KEY;
  if (!foursquareApiKey) {
    console.warn('Foursquare API key not found - returning empty results');
    return [];
  }

  try {
    const radiusMeters = radiusKm * 1000; // Convert to meters
    
    // Foursquare categories likely to have changing facilities
    const categories = [
      '13065', // Restaurant
      '17069', // Shopping Mall
      '17000', // Retail
      '13003', // Fast Food
      '17127', // Gas Station
      '10027', // Zoo
      '10001', // Arts & Entertainment
      '18021', // Gym / Fitness
      '13035', // Coffee Shop
      '17031', // Department Store
      '17043', // Supermarket
    ].join(',');

    // Build Foursquare API request - using the correct endpoint
    const foursquareUrl = `https://places-api.foursquare.com/places/search?ll=${lat}%2C${lng}&radius=${radiusMeters}&categories=${categories}&limit=50&v=20240101`;
    console.log('Fetching from Foursquare:', foursquareUrl);

    const response = await fetch(foursquareUrl, {
  headers: {
    'Accept': 'application/json',
    'Authorization': `Bearer ${foursquareApiKey}`,
    'X-Places-Api-Version': '2025-06-17'
  }
});

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Foursquare API error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    console.log('Raw Foursquare API response - first result:', JSON.stringify(data.results[0], null, 2));
    
    if (!data.results || data.results.length === 0) {
      console.log('No Foursquare results found');
      return [];
    }

    console.log('Foursquare returned', data.results.length, 'places');

    // Transform Foursquare results to match our format
    const transformedResults = data.results.map((place: any) => ({
      fsq_id: place.fsq_place_id,
      name: place.name,
      location: place.location,
      latitude: place.latitude,
      longitude: place.longitude,
      categories: place.categories,
      distance: place.distance,
      geocodes: place.geocodes,
      // Add flags for our app
      isGuaranteedChain: this.isGuaranteedChain(place.name),
      changingStationScore: this.calculateChangingStationScore(place)
    }));

    // Sort by relevance
    return transformedResults.sort((a, b) => {
      // Guaranteed chains first
      if (a.isGuaranteedChain && !b.isGuaranteedChain) return -1;
      if (!a.isGuaranteedChain && b.isGuaranteedChain) return 1;
      // Then by score
      if (a.changingStationScore !== b.changingStationScore) {
        return b.changingStationScore - a.changingStationScore;
      }
      // Finally by distance
      return (a.distance || Infinity) - (b.distance || Infinity);
    });

  } catch (error) {
    console.error('Error searching Foursquare:', error);
    return [];
  }
}

  // Calculate likelihood score for changing station availability
  private calculateChangingStationScore(place: any): number {
    let score = 0;
    const name = place.name?.toLowerCase() || '';
    const categories = place.categories || [];
    
    // Guaranteed chains get highest score
    if (this.isGuaranteedChain(name)) return 4;
    
    // Shopping centers and malls very likely
    const categoryNames = categories.map((cat: any) => cat.name?.toLowerCase() || '');
    if (categoryNames.some((cat: string) => cat.includes('mall') || cat.includes('department store'))) {
      score = 3;
    }
    // Restaurants and supermarkets likely
    else if (categoryNames.some((cat: string) => cat.includes('restaurant') || cat.includes('supermarket') || cat.includes('grocery'))) {
      score = 2;
    }
    // Gas stations possible
    else if (categoryNames.some((cat: string) => cat.includes('gas') || cat.includes('fuel'))) {
      score = 1.5;
    }
    // Other places possible
    else {
      score = 1;
    }
    
    return score;
  }
}

   // DbStorage Class
export class DbStorage implements IStorage {
  private guaranteedChains = [
    'Target', 'Walmart', 'Kroger', 'Meijer', 'Chick-fil-A', 
    'Panera Bread', "Love's Travel Stop", 'Pilot Flying J',
    "Buc-ee's", 'Barnes & Noble', 'Buy Buy Baby', 'Babies"R"Us',
    'Whole Foods Market', 'Wegmans', 'H-E-B', 'Publix',
    'Home Depot', "Lowe's"
  ];

  private isGuaranteedChain(businessName: string): boolean {
    return this.guaranteedChains.some(chain => 
      businessName.toLowerCase().includes(chain.toLowerCase())
    );
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  async getChangingStations(): Promise<ChangingStation[]> {
    return await db.select().from(changingStations);
  }

  async getChangingStation(id: number): Promise<ChangingStation | undefined> {
    const result = await db.select().from(changingStations).where(eq(changingStations.id, id));
    return result[0];
  }

  async createChangingStation(station: InsertChangingStation): Promise<ChangingStation> {
    const result = await db.insert(changingStations).values(station).returning();
    return result[0];
  }

  async searchChangingStations(query: string): Promise<ChangingStation[]> {
    const normalizedQuery = `%${query.toLowerCase()}%`;
    return await db.select().from(changingStations).where(
      like(changingStations.businessName, normalizedQuery)
    );
  }

  async getChangingStationsNearby(lat: number, lng: number, radiusKm: number = 16): Promise<ChangingStation[]> {
    const stations = await db.select().from(changingStations);
    return stations.filter(station => {
      const distance = this.calculateDistance(lat, lng, station.latitude, station.longitude);
      return distance <= radiusKm;
    }).sort((a, b) => 
      this.calculateDistance(lat, lng, a.latitude, a.longitude) - 
      this.calculateDistance(lat, lng, b.latitude, b.longitude)
    );
  }

  async getReviewsForStation(stationId: number): Promise<Review[]> {
    return await db.select().from(reviews).where(eq(reviews.stationId, stationId));
  }

  async createReview(review: InsertReview): Promise<Review> {
    const result = await db.insert(reviews).values(review).returning();
    await this.updateStationRating(review.stationId);
    return result[0];
  }

  async updateStationRating(stationId: number): Promise<void> {
    const station = await this.getChangingStation(stationId);
    if (!station) return;

    const stationReviews = await this.getReviewsForStation(stationId);
    
    if (stationReviews.length === 0) {
      await db.update(changingStations)
        .set({ 
          averageRating: 0, 
          reviewCount: 0,
          negativeReports: 0 
        })
        .where(eq(changingStations.id, stationId));
      return;
    }

    const totalRating = stationReviews.reduce((sum, review) => sum + review.rating, 0);
    const averageRating = Math.round((totalRating / stationReviews.length) * 10) / 10;
    const negativeReports = stationReviews.filter(r => r.reportNoChangingStation === true).length;
    const positiveReviews = stationReviews.filter(r => r.confirmHasChangingStation === true).length;

    const updates: any = {
      averageRating,
      reviewCount: stationReviews.length,
      negativeReports
    };

    if (negativeReports > positiveReviews) {
      updates.hasChangingStation = false;
    } else if (positiveReviews > 0) {
      updates.hasChangingStation = true;
      if (!this.isGuaranteedChain(station.businessName)) {
        updates.isVerified = true;
      }
    }

    await db.update(changingStations)
      .set(updates)
      .where(eq(changingStations.id, stationId));
  }

  async findOrCreateStationFromPlace(placeData: any): Promise<ChangingStation> {
    const allStations = await this.getChangingStations();
    const existing = allStations.find(station => 
      Math.abs(station.latitude - placeData.latitude) < 0.0001 &&
      Math.abs(station.longitude - placeData.longitude) < 0.0001
    );
    
    if (existing) {
      return existing;
    }
    
    const isGuaranteed = this.isGuaranteedChain(placeData.businessName);
    
    const stationData: InsertChangingStation = {
      businessName: placeData.businessName,
      address: placeData.address,
      latitude: placeData.latitude,
      longitude: placeData.longitude,
      isAccessible: null,
      isPrivate: false,
      hasSupplies: null,
      businessHours: placeData.businessHours || null,
      isOpen: placeData.isOpen || null,
      isVerified: false,
      isGuaranteedChain: isGuaranteed
    };
    
    return await this.createChangingStation(stationData);
  }

  async searchPlacesNearby(lat: number, lng: number, radiusKm: number = 16, query?: string): Promise<any[]> {
    const foursquareApiKey = process.env.FOURSQUARE_API_KEY;
    if (!foursquareApiKey) {
      console.warn('Foursquare API key not found - returning empty results');
      return [];
    }

    try {
      const radiusMeters = radiusKm * 1000;
      
      const categories = [
        '13065', '17069', '17000', '13003', '17127',
        '10027', '10001', '18021', '13035', '17031', '17043'
      ].join(',');

      const foursquareUrl = `https://places-api.foursquare.com/places/search?ll=${lat}%2C${lng}&radius=${radiusMeters}&categories=${categories}&limit=50&v=20240101`;

      const response = await fetch(foursquareUrl, {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${foursquareApiKey}`,
          'X-Places-Api-Version': '2025-06-17'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Foursquare API error:', response.status, errorText);
        return [];
      }

      const data = await response.json();
      
      if (!data.results || data.results.length === 0) {
        return [];
      }

      const transformedResults = data.results.map((place: any) => ({
        fsq_id: place.fsq_place_id,
        name: place.name,
        location: place.location,
        latitude: place.latitude,
        longitude: place.longitude,
        categories: place.categories,
        distance: place.distance,
        geocodes: place.geocodes,
        isGuaranteedChain: this.isGuaranteedChain(place.name),
        changingStationScore: this.calculateChangingStationScore(place)
      }));

      return transformedResults.sort((a, b) => {
        if (a.isGuaranteedChain && !b.isGuaranteedChain) return -1;
        if (!a.isGuaranteedChain && b.isGuaranteedChain) return 1;
        if (a.changingStationScore !== b.changingStationScore) {
          return b.changingStationScore - a.changingStationScore;
        }
        return (a.distance || Infinity) - (b.distance || Infinity);
      });

    } catch (error) {
      console.error('Error searching Foursquare:', error);
      return [];
    }
  }

  private calculateChangingStationScore(place: any): number {
    let score = 0;
    const name = place.name?.toLowerCase() || '';
    const categories = place.categories || [];
    
    if (this.isGuaranteedChain(name)) return 4;
    
    const categoryNames = categories.map((cat: any) => cat.name?.toLowerCase() || '');
    if (categoryNames.some((cat: string) => cat.includes('mall') || cat.includes('department store'))) {
      score = 3;
    } else if (categoryNames.some((cat: string) => cat.includes('restaurant') || cat.includes('supermarket') || cat.includes('grocery'))) {
      score = 2;
    } else if (categoryNames.some((cat: string) => cat.includes('gas') || cat.includes('fuel'))) {
      score = 1.5;
    } else {
      score = 1;
    }
    
    return score;
  }
}

export const storage = new DbStorage();
