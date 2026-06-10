// NotificationsBell — petite cloche cliquable avec badge unread.
//
// Polling : on rafraîchit `unread` toutes les 30 s + à chaque focus
// d'écran (le parent passe `navigation` pour qu'on s'abonne).
// Au tap, on navigue vers l'écran `Notifications` (push stack).
import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import * as api from "../api";
import { C, SHADOW, F } from "../theme";
import { Icon } from "../icons";

const POLL_MS = 30_000;

/**
 * @param {{ navigation: any, color?: string, size?: number, style?: any }}
 */
export default function NotificationsBell({ navigation, color = C.ink, size = 44, style }) {
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try { setUnread(await api.fetchUnreadCount()); }
    catch { /* silencieux — on garde la valeur précédente */ }
  }, []);

  // Poll régulier
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Refresh au focus du screen parent (évite de devoir attendre le poll
  // suivant après un retour de l'écran Notifications).
  useEffect(() => {
    if (!navigation) return;
    const unsub = navigation.addListener("focus", refresh);
    return unsub;
  }, [navigation, refresh]);

  const onPress = () => navigation?.navigate("Notifications");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { width: size, height: size },
        SHADOW.sm,
        pressed && { transform: [{ scale: 0.92 }] },
        style,
      ]}
    >
      <Icon name="bell" size={size * 0.5} color={color} />
      {unread > 0 && (
        <View style={styles.badge}>
          <Text style={[styles.badgeText, { fontFamily: F.bodyBold || F.body }]}>
            {unread > 9 ? "9+" : String(unread)}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: 999, backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  badge: {
    position: "absolute", top: 4, right: 4,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: C.coral,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2, borderColor: "#fff",
  },
  badgeText: { fontSize: 10, color: "#fff", fontWeight: "800" },
});
