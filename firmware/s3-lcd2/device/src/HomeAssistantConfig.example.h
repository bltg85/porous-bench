// Copy to HomeAssistantConfig.h (gitignored) to send app events to Home
// Assistant. Use the Pi's IP address: the board doesn't resolve .local names.
// The webhook ID is the only thing guarding the hook, so keep it out of git.
#define HA_WEBHOOK_URL "http://192.168.1.10:8123/api/webhook/your-webhook-id"
