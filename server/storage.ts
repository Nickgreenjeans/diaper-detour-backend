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
  
  // Google Places Integration for nationwide coverage
  searchPlacesNearby(lat: number, lng: number, radiusKm?: number, query?: string): Promise<any[]>;
}

export class MemStorage implements IStorage {
  private changingStations: Map<number, ChangingStation>;
  private reviews: Map<number, Review>;
  private currentStationId: number;
  private currentReviewId: number;

  // Define guaranteed chains that always have changing stations in the US
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
        businessName: "McDonald's - Downtown Nashville",
        address: "519 Church St, Nashville, TN 37219",
        latitude: 36.1581,
        longitude: -86.7767,
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
      },
      {
        businessName: "Shell - I-40 Exit 208",
        address: "2421 Music Valley Dr, Nashville, TN 37214",
        latitude: 36.2063,
        longitude: -86.6937,
        isAccessible: null, // Unverified
        isPrivate: false,
        hasSupplies: null, // Unverified
        businessHours: '{"mon":"24hrs","tue":"24hrs","wed":"24hrs","thu":"24hrs","fri":"24hrs","sat":"24hrs","sun":"24hrs"}',
        isOpen: true,
        isVerified: false // Unverified gas station
      },
      {
        businessName: "Exxon - I-65 Exit 78",
        address: "111 Old Hickory Blvd, Nashville, TN 37221",
        latitude: 36.0962,
        longitude: -86.8614,
        isAccessible: null, // Unverified
        isPrivate: false,
        hasSupplies: null, // Unverified
        businessHours: '{"mon":"24hrs","tue":"24hrs","wed":"24hrs","thu":"24hrs","fri":"24hrs","sat":"24hrs","sun":"24hrs"}',
        isOpen: true,
        isVerified: false // Unverified gas station
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

    // Add sample reviews
    const sampleReviews: InsertReview[] = [];

    sampleReviews.forEach(review => {
      const reviewWithId: Review = {
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
      this.reviews.set(reviewWithId.id, reviewWithId);
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
        station.isVerified = true;
      }
    }
  }

  // Google Places API integration for US-only coverage
  async searchPlacesNearby(lat: number, lng: number, radiusKm: number = 16, query?: string): Promise<any[]> {
    const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!googleMapsApiKey) {
      console.warn('Google Maps API key not found - returning empty results');
      return [];
    }

    // Restrict to US coordinates only
    if (!this.isWithinUSBounds(lat, lng)) {
      console.log('Location outside US bounds - returning empty results');
      return [];
    }

    try {
      const radiusMeters = radiusKm * 1000; // Convert to meters
      
      // US chains and place types likely to have changing facilities
      const usSearchTerms = [
        'target', 'walmart', 'kroger', 'meijer', 'chick-fil-a', 'panera bread',
        'loves', 'pilot flying j', 'buc-ee', 'barnes noble', 'buy buy baby',
        'whole foods', 'wegmans', 'h-e-b', 'publix', 'starbucks', 'dunkin',
        'mcdonalds', 'subway', 'taco bell', 'burger king', 'wendys', 'kfc',
        'cvs', 'walgreens', 'rite aid', 'home depot', 'lowes'
      ];
      
      // Place types that typically have changing facilities in the US
      const placeTypes = [
        'shopping_mall', 'department_store', 'supermarket', 
        'restaurant', 'gas_station', 'amusement_park', 'zoo',
        'cafe', 'pharmacy', 'home_goods_store', 'library'
      ];

      // Interstate gas station chains (mostly unverified except guaranteed ones)
      const gasStationChains = [
        'shell', 'exxon', 'mobil', 'chevron', 'bp', 'marathon', 'speedway',
        'circle k', 'wawa', 'sheetz', 'quiktrip', 'casey', 'flying j', 'ta',
        'travel centers of america', 'petro stopping centers'
      ];

      const allResults = [];
      const searchLimit = query ? 8 : 15; // More searches when user has specific query, include gas stations

      // If user provided query, search for it specifically
      if (query) {
        const queryUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(query)}&key=${googleMapsApiKey}`;
        
        try {
          const response = await fetch(queryUrl);
          const data = await response.json();
          if (data.results) {
            allResults.push(...data.results);
          }
        } catch (error) {
          console.error('Error fetching query results:', error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Search for US chain locations
      for (const chain of usSearchTerms.slice(0, Math.floor(searchLimit / 2))) {
        const chainUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(chain)}&key=${googleMapsApiKey}`;
        
        try {
          const response = await fetch(chainUrl);
          const data = await response.json();
          if (data.results) {
            allResults.push(...data.results.map((place: any) => ({
              ...place,
              isGuaranteedChain: this.isGuaranteedChain(place.name),
              chainName: chain
            })));
          }
        } catch (error) {
          console.error(`Error fetching places for ${chain}:`, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Search for interstate gas stations (unverified except guaranteed chains)
      if (!query || query.toLowerCase().includes('gas') || query.toLowerCase().includes('station')) {
        for (const gasStation of gasStationChains.slice(0, 4)) {
          const gasUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(gasStation)}&key=${googleMapsApiKey}`;
          
          try {
            const response = await fetch(gasUrl);
            const data = await response.json();
            if (data.results) {
              const gasResults = data.results.map((place: any) => ({
                ...place,
                isGuaranteedChain: this.isGuaranteedChain(place.name),
                isUnverifiedGasStation: !this.isGuaranteedChain(place.name),
                chainName: gasStation
              }));
              allResults.push(...gasResults);
            }
          } catch (error) {
            console.error(`Error fetching gas stations for ${gasStation}:`, error);
          }
          
          await new Promise(resolve => setTimeout(resolve, 150));
        }
      }

      // Search by place types for US coverage
      for (const placeType of placeTypes.slice(0, Math.ceil(searchLimit / 2))) {
        const typeUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&type=${placeType}&key=${googleMapsApiKey}`;
        
        try {
          const response = await fetch(typeUrl);
          const data = await response.json();
          if (data.results) {
            // Filter for US businesses only
            const filteredResults = data.results.filter((place: any) => 
              (place.rating >= 3.5 || // Good rating
              place.types?.includes('shopping_mall') || // Likely to have facilities
              place.types?.includes('department_store') ||
              this.isGuaranteedChain(place.name)) && // Known chains
              this.isUSBusiness(place) // US business verification
            );
            allResults.push(...filteredResults);
          }
        } catch (error) {
          console.error(`Error fetching places for type ${placeType}:`, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Deduplicate by place_id
      const uniqueResults = Array.from(
        new Map(allResults.map(place => [place.place_id, place])).values()
      );

      // Score and sort results for relevance
      return uniqueResults
        .map(place => ({
          ...place,
          isGuaranteedChain: this.isGuaranteedChain(place.name),
          changingStationScore: this.calculateChangingStationScore(place)
        }))
        .sort((a, b) => {
          // First by guaranteed status
          if (a.isGuaranteedChain && !b.isGuaranteedChain) return -1;
          if (!a.isGuaranteedChain && b.isGuaranteedChain) return 1;
          // Then by score
          if (a.changingStationScore !== b.changingStationScore) {
            return b.changingStationScore - a.changingStationScore;
          }
          // Finally by rating
          return (b.rating || 0) - (a.rating || 0);
        })
        .slice(0, 50); // Limit results for performance

    } catch (error) {
      console.error('Error searching Google Places:', error);
      return [];
    }
  }

  // Calculate likelihood score for changing station availability
  private calculateChangingStationScore(place: any): number {
    let score = 0;
    const name = place.name?.toLowerCase() || '';
    const types = place.types || [];
    
    // Guaranteed chains get highest score
    if (this.isGuaranteedChain(name)) return 4;
    
    // Gas stations on interstates (unverified but possible)
    if (place.isUnverifiedGasStation || (types.includes('gas_station') && !this.isGuaranteedChain(name))) {
      score = 1.5; // Lower than guaranteed but worth showing as unverified
    }
    // Shopping centers and malls very likely
    else if (types.includes('shopping_mall') || types.includes('department_store')) {
      score = 3;
    }
    // Restaurants and supermarkets likely
    else if (types.includes('restaurant') || types.includes('supermarket')) {
      score = 2;
    }
    // Other places possible
    else {
      score = 1;
    }
    
    // Boost for higher ratings
    if (place.rating >= 4.0) score += 0.5;
    
    return score;
  }

  // Check if coordinates are within US bounds
  private isWithinUSBounds(lat: number, lng: number): boolean {
    // Continental US bounds (including Alaska and Hawaii)
    const usBounds = {
      north: 71.5388001, // Alaska
      south: 18.7763, // Hawaii
      east: -66.885417, // Maine
      west: -179.9 // Alaska
    };
    
    return lat >= usBounds.south && lat <= usBounds.north &&
           lng >= usBounds.west && lng <= usBounds.east;
  }

  // Verify if a business is US-based
  private isUSBusiness(place: any): boolean {
    const address = place.vicinity || place.formatted_address || '';
    const name = place.name || '';
    
    // Check for US state abbreviations or common US indicators
    const usIndicators = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|USA|United States)\b/i;
    
    return usIndicators.test(address) || usIndicators.test(name);
  }
}

export const storage = new MemStorage();