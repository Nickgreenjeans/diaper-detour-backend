import { pgTable, text, serial, integer, boolean, real, timestamp, varchar, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  appleUserId: text("apple_user_id").notNull().unique(),
  email: text("email"),
  firstName: text("first_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expoPushToken: text("expo_push_token"),
});

export const insertUserSchema = createInsertSchema(users);
export const selectUserSchema = createSelectSchema(users);
export const changingStations = pgTable("changing_stations", {
  id: serial("id").primaryKey(),
  businessName: text("business_name").notNull(),
  address: text("address").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  isAccessible: boolean("is_accessible").default(false),
  isPrivate: boolean("is_private").default(false),
  hasSupplies: boolean("has_supplies").default(false),
  averageRating: real("average_rating").default(0),
  reviewCount: integer("review_count").default(0),
  businessHours: text("business_hours"),
  isOpen: boolean("is_open").default(true),
  hasChangingStation: boolean("has_changing_station").default(true),
  negativeReports: integer("negative_reports").default(0),
  isVerified: boolean("is_verified").default(false),
  isGuaranteedChain: boolean("is_guaranteed_chain").default(false),
});

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  stationId: integer("station_id").notNull().references(() => changingStations.id),
  authorName: text("author_name").notNull(),
  rating: integer("rating").notNull(),
  content: text("content"),
  isCleanliness: boolean("is_cleanliness").default(false),
  isWellStocked: boolean("is_well_stocked").default(false),
  isAccessible: boolean("is_accessible").default(false),
  isPrivate: boolean("is_private").default(false),
  reportNoChangingStation: boolean("report_no_changing_station").default(false),
  confirmHasChangingStation: boolean("confirm_has_changing_station").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertChangingStationSchema = createInsertSchema(changingStations).omit({
  id: true,
  averageRating: true,
  reviewCount: true,
  negativeReports: true,
});

export const insertReviewSchema = createInsertSchema(reviews).omit({
  id: true,
  createdAt: true,
});

export const userAnalytics = pgTable("user_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull(),
  eventType: varchar("event_type").notNull(),
  eventData: jsonb("event_data"),
  deviceInfo: jsonb("device_info"),
  locationData: jsonb("location_data"),
  networkType: varchar("network_type"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const appUsageMetrics = pgTable("app_usage_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull(),
  sessionId: varchar("session_id").notNull(),
  sessionStart: timestamp("session_start").defaultNow(),
  sessionEnd: timestamp("session_end"),
  stationsViewed: jsonb("stations_viewed").default('[]'),
  searchQueries: jsonb("search_queries").default('[]'),
  featuresUsed: jsonb("features_used").default('[]'),
  appVersion: varchar("app_version"),
  batteryLevel: integer("battery_level"),
  networkQuality: varchar("network_quality"),
});

export const userSignups = pgTable("user_signups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull(),
  signupMethod: varchar("signup_method"),
  referralSource: varchar("referral_source"),
  firstStationViewed: integer("first_station_viewed").references(() => changingStations.id),
  signupLocation: jsonb("signup_location"),
  marketingConsent: boolean("marketing_consent").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserAnalyticSchema = createInsertSchema(userAnalytics).omit({
  id: true,
  timestamp: true,
});

export const insertAppUsageMetricSchema = createInsertSchema(appUsageMetrics).omit({
  id: true,
  sessionStart: true,
});

export const insertUserSignupSchema = createInsertSchema(userSignups).omit({
  id: true,
  createdAt: true,
});

export type InsertChangingStation = z.infer<typeof insertChangingStationSchema>;
export type ChangingStation = typeof changingStations.$inferSelect;
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;
export type UserAnalytic = typeof userAnalytics.$inferSelect;
export type InsertUserAnalytic = z.infer<typeof insertUserAnalyticSchema>;
export type AppUsageMetric = typeof appUsageMetrics.$inferSelect;
export type InsertAppUsageMetric = z.infer<typeof insertAppUsageMetricSchema>;
export type UserSignup = typeof userSignups.$inferSelect;
export type InsertUserSignup = z.infer<typeof insertUserSignupSchema>;
