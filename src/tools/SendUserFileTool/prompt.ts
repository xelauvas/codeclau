export const SEND_USER_FILE_TOOL_NAME = 'SendUserFile'

export const DESCRIPTION = 'Deliver a file to the user'

export const SEND_USER_FILE_PROMPT = `Deliver a file you produced (report, export, screenshot, archive) to the user.

The file is copied into the session outbox directory and the user is told where it is, so it survives temporary directories being cleaned up. Use it for deliverables the user asked for, not for every file you touch. Pass a short description so the notification is meaningful.`
