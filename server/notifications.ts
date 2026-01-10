import { storage } from './storage';

interface PushNotification {
  to: string;
  sound: string;
  title: string;
  body: string;
  data: {
    stationId: string;
    stationName: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
}

export async function sendPushNotification(
  expoPushToken: string,
  stationId: string,
  stationName: string,
  address?: string,
  latitude?: number,
  longitude?: number
) {
  const message: PushNotification = {
    to: expoPushToken,
    sound: 'default',
    title: 'How was the changing station? 🚼',
    body: `Help other parents at ${stationName}`,
    data: {
      stationId,
      stationName,
      address,
      latitude,
      longitude,
    },
  };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const data = await response.json();
    console.log('✅ Push notification sent:', data);
    return data;
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    throw error;
  }
}

export async function checkAndSendPendingNotifications() {
  console.log('🔔 Checking for pending notifications...');
  
  try {
    const pendingNavigations = await storage.getPendingNavigations();
    
    console.log(`📬 Found ${pendingNavigations.length} pending notifications`);
    
    for (const nav of pendingNavigations) {
      // Access joined user data
      const user = nav.users;
      const navigation = nav.user_navigations;
      
      if (!user.expoPushToken) {
        console.log(`⚠️ No push token for user ${user.id}, skipping...`);
        await storage.markNavigationSent(navigation.id);
        continue;
      }
      
      console.log(`📤 Sending notification for ${navigation.stationName} to user ${user.id}`);
      
      try {
        await sendPushNotification(
          user.expoPushToken,
          navigation.stationId,
          navigation.stationName
        );
        
        await storage.markNavigationSent(navigation.id);
        console.log(`✅ Notification sent and marked for navigation ${navigation.id}`);
      } catch (error) {
        console.error(`❌ Failed to send notification for navigation ${navigation.id}:`, error);
      }
    }
  } catch (error) {
    console.error('❌ Error in checkAndSendPendingNotifications:', error);
  }
}

// Run check every minute
export function startNotificationScheduler() {
  console.log('🚀 Starting notification scheduler...');
  
  // Check immediately on start
  checkAndSendPendingNotifications();
  
  // Then check every 60 seconds
  setInterval(() => {
    checkAndSendPendingNotifications();
  }, 60000); // 60 seconds
}
