import "react-native-gesture-handler";
import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

// Polices : Fredoka pour le display, Nunito pour le body. Voir theme.js
// où on alimente F.display / F.body avec ces noms une fois chargés.
import {
  useFonts as useFredoka,
  Fredoka_400Regular,
  Fredoka_500Medium,
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from "@expo-google-fonts/fredoka";
import {
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from "@expo-google-fonts/nunito";

import { AuthProvider, useAuth } from "./src/auth";
import LoginScreen from "./src/screens/LoginScreen";
import SignUpScreen from "./src/screens/SignUpScreen";
import HomeScreen from "./src/screens/HomeScreen";
import MapScreen from "./src/screens/MapScreen";
import LabDetailScreen from "./src/screens/LabDetailScreen";
import CartScreen from "./src/screens/CartScreen";
import BookingsScreen from "./src/screens/BookingsScreen";
import ResultDetailScreen from "./src/screens/ResultDetailScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import { C, applyFonts } from "./src/theme";
import { Icon } from "./src/icons";

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

// ── Tab bar — icônes vectorielles Feather/Ionicons ──────────────────
function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: "#9FB0B4",
        tabBarStyle: {
          backgroundColor: "#fff",
          borderTopColor: C.hairSoft,
          height: 64,
          paddingBottom: 10, paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "800" },
      }}
    >
      <Tabs.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          tabBarLabel: "Accueil",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "homeFill" : "home"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="BookingsTab"
        component={BookingsScreen}
        options={{
          tabBarLabel: "Mes RDV",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "calendarFill" : "calendar"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          tabBarLabel: "Profil",
          tabBarIcon: ({ color, focused }) => (
            <Icon name={focused ? "userFill" : "user"} size={24} color={color} />
          ),
        }}
      />
    </Tabs.Navigator>
  );
}

function RootNav() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}>
        <ActivityIndicator color={C.brand} size="large" />
      </View>
    );
  }
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!user ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="SignUp" component={SignUpScreen} options={{ animation: "slide_from_bottom" }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Map" component={MapScreen} options={{ animation: "slide_from_right" }} />
          <Stack.Screen name="LabDetail" component={LabDetailScreen} options={{ animation: "slide_from_right" }} />
          <Stack.Screen name="Cart" component={CartScreen} options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="ResultDetail" component={ResultDetailScreen} options={{ animation: "slide_from_right" }} />
          {/* BookingsScreen monté UNIQUEMENT dans MainTabs — depuis Cart on
              utilise CommonActions.reset vers Main / BookingsTab, jamais
              un navigate("Bookings") (qui ferait planter Expo SDK 54). */}
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  // Charge Fredoka (display) + Nunito (body). Tant que les polices ne
  // sont pas prêtes, on affiche un splash neutre — RN tomberait sinon
  // sur la font système et on aurait un "flash" de typo au switch.
  const [fontsLoaded] = useFredoka({
    Fredoka_400Regular,
    Fredoka_500Medium,
    Fredoka_600SemiBold,
    Fredoka_700Bold,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });

  // Une fois les polices chargées, on patche le theme pour que toutes
  // les feuilles de styles qui lisent `F.display` / `F.body` aient les
  // bons noms. Idempotent.
  useEffect(() => {
    if (fontsLoaded) {
      applyFonts({
        display: "Fredoka_600SemiBold",
        displayBold: "Fredoka_700Bold",
        body: "Nunito_700Bold",
        bodyBold: "Nunito_800ExtraBold",
      });
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}>
        <ActivityIndicator color={C.brand} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <NavigationContainer>
          <RootNav />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
