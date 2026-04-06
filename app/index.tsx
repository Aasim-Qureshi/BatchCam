import { Redirect } from "expo-router";
import { useAuth } from "../api/AuthContext";

export default function Index() {
  const { user } = useAuth();

  if (!user) return <Redirect href="/login" />;

  return <Redirect href="/camera" />;
}
