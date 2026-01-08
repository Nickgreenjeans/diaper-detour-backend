import { db } from './db';
import { eq, sql as drizzleSql, like, and } from 'drizzle-orm';
import { changingStations, reviews, users, type ChangingStation, type InsertChangingStation, type Review, type InsertReview } from "./schema";

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
  
  // User methods
  getUserByAppleId(appleUserId: string): Promise<any>;
  createUser(userData: any): Promise<any>;
  updateUserPushToken(appleUserId: string, expoPushToken: string): Promise<any>;
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
        isVerified: true,
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
  '4bf58dd8d48988d1c4941735', // Restaurant
  '4bf58dd8d48988d157941735', // New American Restaurant
  '52e81612bcbc57f1066b7a00', // Comfort Food Restaurant
  '4bf58dd8d48988d1f9941735', // Food and Beverage
  '4bf58dd8d48988d16e941735', // Fast Food
  '4bf58dd8d48988d1e0931735', // Coffee Shop
  '4bf58dd8d48988d113951735', // Fuel Station
  '4bf58dd8d48988d113951735', // Gas Station
  '4bf58dd8d48988d1fd941735', // Shopping Mall
  '52f2ab2ebcbc57f1066b8b46', // Supermarket
  '4bf58dd8d48988d118951735', // Grocery Store
  '4bf58dd8d48988d1f6941735', // Department Store
  '4d954b0ea243a5684a65b473', // Convenience Store
  '4bf58dd8d48988d10f951735', // Pharmacy
  '5745c2e4498e11e7bccabdbd', // Drugstore
].join(',');

    // Foursquare Chain ID's likely to have changing stations
    const chains = [
  '556e1846a7c82e6b72513d6b', // Chick-Fil-A
  '5665d0e560b2cc5383d258e8', // Buc-ee's
  '556e119fa7c82e6b725012dd', // Target
  '556f676fbd6a75a99038d8ec', // Starbucks
  '556d1914aceaff43eb0a123a', // Circle K
  '556dfa53a7c82e6b724de09d', // Murphy USA
  '60241dda9873ff0e979a2d81', // Pilot Flying J
  '556a3897a7c8957d73d55984', // Racetrac
  '556f5631bd6a75a99036ab9a', // BP
  '556ce2a7aceaff43eb04b494', // CITGO
  '556f46f6bd6a007c77390fae', // Chevron
  '556f676fbd6a75a99038d8e9', // 7-Eleven Gas Station
  '556c9aeba7c87f637869ce12', // Love's Travel Stop
  '556f7a12bd6a75a9903bddb6', // Shell Gas Station
  '590b3d809411f25cbb00e94f', // Marathon Gas Station
  '556ca0b7a7c87f63786a354b', // Maverik Gas Station
  '556f3d48bd6a007c7737e8e4', // Mapco Gas Station
  '66e9905dd014de302a240305', // ExxonMobil
  '556f676fbd6a75a99038d8e2', // Exxon
  '5d978ca330ff59000c275a70', // Exxon Convenience Stores
  '556f5631bd6a75a99036ab99', // Walgreens
  '58ff89c9d8fe7a2faa3998ed', // Walgreens Clinic
  '556f5631bd6a75a99036ab9b', // CVS Pharmacy
].join(',');

    // Build Foursquare API request - using the correct endpoint
const foursquareUrl = `https://places-api.foursquare.com/places/search?ll=${lat}%2C${lng}&radius=${radiusMeters}&fsq_category_ids=${categories}&fsq_chain_ids=${chains}&limit=50&v=20240101`;

// LOG API CALL
const callTimestamp = new Date().toISOString();
console.log('🔵 FOURSQUARE API CALL:', {
  timestamp: callTimestamp,
  location: `${lat},${lng}`,
  radius: `${radiusKm}km`,
  url: foursquareUrl
});

const startTime = Date.now();
const response = await fetch(foursquareUrl, {
  headers: {
    'Accept': 'application/json',
    'Authorization': `Bearer ${foursquareApiKey}`,
    'X-Places-Api-Version': '2025-06-17'
  }
});

const duration = Date.now() - startTime;

if (!response.ok) {
  const errorText = await response.text();
  console.error('❌ FOURSQUARE API ERROR:', {
    status: response.status,
    duration: `${duration}ms`,
    error: errorText
  });
  return [];
}

const data = await response.json();

// LOG API RESPONSE
console.log('FOURSQUARE API SUCCESS:', {
  duration: duration + 'ms',
  resultsCount: data.results?.length || 0,
  timestamp: callTimestamp
});

if (!data.results || data.results.length === 0) {
  console.log('No Foursquare results found');
  return [];
}

/// Transform Foursquare results to match format
const transformedResults = data.results.map((place: any) => ({
  fsq_id: place.fsq_place_id,
  name: place.name,
  location: place.location,
  latitude: place.latitude,
  longitude: place.longitude,
  categories: place.categories,
  chains: place.chains,
  distance: place.distance,
  geocodes: place.geocodes,
  isGuaranteedChain: this.isGuaranteedChain(place.name),
  changingStationScore: this.calculateChangingStationScore(place)
}));

// Sort by relevance
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

  // Calculate likelihood score for changing station availability
  private calculateChangingStationScore(place: any): number {
  let score = 0;
  const name = place.name?.toLowerCase() || '';
  const categories = place.categories || [];
  const chains = place.chains || []; // Add chains detection
  
  // Guaranteed chains get highest score (by NAME)
  if (this.isGuaranteedChain(name)) return 4;
  
  // TIER 1 - Priority Chains
  const priorityChainIds = [
    '556f7a12bd6a75a9903bddb6', // Shell
    '556c9aeba7c87f637869ce12', // Love's Travel Stop
    '556f5631bd6a75a99036ab99', // Walgreens
    '556f5631bd6a75a99036ab9b', // CVS Pharmacy
    '556e1846a7c82e6b72513d6b', // Chick-fil-A
    '5665d0e560b2cc5383d258e8', // Buc-ee's
    '556f676fbd6a75a99038d8ec', // Starbucks
    '556ca0b7a7c87f63786a354b', // Maverik
    '556e119fa7c82e6b725012dd', // Target
  ];
  
  if (chains.some((chain: any) => tier1ChainIds.includes(chain.fsq_chain_id))) {
    return 3.8;
  }

  // TIER 2 - Other known chains 
  const tier2ChainIds = [
  '556d1914aceaff43eb0a123a', // Circle K
  '556dfa53a7c82e6b724de09d', // Murphy USA
  '60241dda9873ff0e979a2d81', // Pilot Flying J
  '556a3897a7c8957d73d55984', // Racetrac
  '556f5631bd6a75a99036ab9a', // BP
  '556ce2a7aceaff43eb04b494', // CITGO
  '556f46f6bd6a007c77390fae', // Chevron
  '556f676fbd6a75a99038d8e9', // 7-Eleven Gas Station
  '590b3d809411f25cbb00e94f', // Marathon Gas Station
  '556f3d48bd6a007c7737e8e4', // Mapco Gas Station
  '66e9905dd014de302a240305', // ExxonMobil
  '556f676fbd6a75a99038d8e2', // Exxon
  '5d978ca330ff59000c275a70', // Exxon Convenience Stores
  '58ff89c9d8fe7a2faa3998ed', // Walgreens Clinic
 ];

 if (chains.some((chain: any) => tier2ChainIds.includes(chain.fsq_chain_id))) {
   return 3.2;
 }
  // Gas stations and convenience stores very likely (by CATEGORY)
  const categoryNames = categories.map((cat: any) => cat.name?.toLowerCase() || '');
  if (categoryNames.some((cat: string) => 
    cat.includes('gas') || 
    cat.includes('fuel') || 
    cat.includes('convenience') || 
    cat.includes('pharmacy')
  )) {
    score = 3;
  }
  // Restaurants and supermarkets likely
  else if (categoryNames.some((cat: string) => 
    cat.includes('restaurant') || 
    cat.includes('supermarket') || 
    cat.includes('grocery')
  )) {
    score = 2;
  }
  // Shopping centers and malls possible
  else if (categoryNames.some((cat: string) => 
    cat.includes('mall') || 
    cat.includes('department store')
  )) {
    score = 1.5;
  }
  // Everything else
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
    '4bf58dd8d48988d1c4941735', // Restaurant
    '4bf58dd8d48988d157941735', // New American Restaurant
    '52e81612bcbc57f1066b7a00', // Comfort Food Restaurant
    '4bf58dd8d48988d1f9941735', // Food and Beverage
    '4bf58dd8d48988d16e941735', // Fast Food
    '4bf58dd8d48988d1e0931735', // Coffee Shop
    '4bf58dd8d48988d113951735', // Fuel Station
    '4bf58dd8d48988d113951735', // Gas Station
    '4bf58dd8d48988d1fd941735', // Shopping Mall
    '52f2ab2ebcbc57f1066b8b46', // Supermarket
    '4bf58dd8d48988d118951735', // Grocery Store
    '4bf58dd8d48988d1f6941735', // Department Store
    '4d954b0ea243a5684a65b473', // Convenience Store
    '4bf58dd8d48988d10f951735', // Pharmacy
    '5745c2e4498e11e7bccabdbd', // Drugstore
   ].join(',');

   const chains = [
    '556e1846a7c82e6b72513d6b', // Chick-Fil-A
    '5665d0e560b2cc5383d258e8', // Buc-ee's
    '556e119fa7c82e6b725012dd', // Target
    '556f676fbd6a75a99038d8ec', // Starbucks
    '556d1914aceaff43eb0a123a', // Circle K
    '556dfa53a7c82e6b724de09d', // Murphy USA
    '60241dda9873ff0e979a2d81', // Pilot Flying J
    '556a3897a7c8957d73d55984', // Racetrac
    '556f5631bd6a75a99036ab9a', // BP
    '556ce2a7aceaff43eb04b494', // CITGO
    '556f46f6bd6a007c77390fae', // Chevron
    '556f676fbd6a75a99038d8e9', // 7-Eleven Gas Station
    '556c9aeba7c87f637869ce12', // Love's Travel Stop
    '556f7a12bd6a75a9903bddb6', // Shell Gas Station
    '590b3d809411f25cbb00e94f', // Marathon Gas Station
    '556ca0b7a7c87f63786a354b', // Maverik Gas Station
    '556f3d48bd6a007c7737e8e4', // Mapco Gas Station
    '66e9905dd014de302a240305', // ExxonMobil
    '556f676fbd6a75a99038d8e2', // Exxon
    '5d978ca330ff59000c275a70', // Exxon Convenience Stores
    '556f5631bd6a75a99036ab99', // Walgreens
    '58ff89c9d8fe7a2faa3998ed', // Walgreens Clinic
    '556f5631bd6a75a99036ab9b', // CVS Pharmacy
   ].join(',');
      
      const foursquareUrl = `https://places-api.foursquare.com/places/search?ll=${lat}%2C${lng}&radius=${radiusMeters}&fsq_category_ids=${categories}&fsq_chain_ids=${chains}&limit=50&v=20240101`;
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
  
// User methods
async getUserByAppleId(appleUserId: string) {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.appleUserId, appleUserId))
    .limit(1);
  return user || null;
}

async createUser(userData: any) {
  const [newUser] = await db
    .insert(users)
    .values(userData)
    .returning();
  return newUser;
}

async updateUserPushToken(appleUserId: string, expoPushToken: string) {
  const [updatedUser] = await db
    .update(users)
    .set({ expoPushToken })
    .where(eq(users.appleUserId, appleUserId))
    .returning();
  return updatedUser || null;
}
}

export const storage = new DbStorage();
