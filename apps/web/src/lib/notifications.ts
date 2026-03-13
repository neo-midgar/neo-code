export type NotificationSupportState = NotificationPermission | "unsupported";

export function getNotificationPermission(): NotificationSupportState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationSupportState> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.requestPermission();
}

export function shouldShowBackgroundSystemNotification(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState !== "visible" || !document.hasFocus();
}

export function showSystemNotification(input: {
  title: string;
  body?: string;
  tag?: string;
  onClick?: () => void;
}): Notification | null {
  if (getNotificationPermission() !== "granted") {
    return null;
  }

  const notification = new Notification(input.title, {
    ...(input.body ? { body: input.body } : {}),
    ...(input.tag ? { tag: input.tag } : {}),
  });

  if (input.onClick) {
    notification.addEventListener("click", (event) => {
      event.preventDefault();
      input.onClick?.();
      notification.close();
    });
  }

  return notification;
}
