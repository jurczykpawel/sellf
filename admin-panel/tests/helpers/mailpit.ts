/**
 * Helper functions for Mailpit API
 * Mailpit is the email testing service used by Supabase local development
 */

const MAILPIT_URL = 'http://127.0.0.1:54324';

export interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: { Name: string; Address: string };
  To: Array<{ Name: string; Address: string }>;
  Subject: string;
  Created: string;
  Text?: string;
  HTML?: string;
}

/**
 * Search for messages by recipient email
 */
export async function searchMessages(email: string): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=to:${encodeURIComponent(email)}`);
  if (!response.ok) {
    throw new Error(`Mailpit search failed: ${response.statusText}`);
  }
  const data = await response.json();
  return data.messages || [];
}

/**
 * Get full message including body
 */
export async function getMessage(messageId: string): Promise<MailpitMessage> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${messageId}`);
  if (!response.ok) {
    throw new Error(`Mailpit get message failed: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Extract magic link from email text
 */
export function extractMagicLink(emailText: string): string | null {
  // Sellf magic-link emails link to /auth/callback with a token_hash param
  const match = emailText.match(/(https?:\/\/[^\s)]+\/auth\/callback\?[^\s)]+)/);
  return match ? match[1] : null;
}

/**
 * Wait for email to arrive and return it
 */
export async function waitForEmail(
  email: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<MailpitMessage> {
  const timeout = options.timeout || 10000;
  const interval = options.interval || 1000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await searchMessages(email);

    if (messages.length > 0) {
      // Get the latest message
      const latestMessageId = messages[0].ID;
      return getMessage(latestMessageId);
    }

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`No email received for ${email} within ${timeout}ms`);
}

/**
 * Delete all messages (cleanup)
 */
export async function deleteAllMessages(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}
