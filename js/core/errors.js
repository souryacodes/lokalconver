// One error type for everything the user can run into.
// "code" is for the program, "userMessage" is shown to the person.
export class ConvertError extends Error {
  constructor(code, userMessage, detail) {
    super(userMessage);
    this.name = 'ConvertError';
    this.code = code;
    this.userMessage = userMessage;
    this.detail = detail; // never shown, never includes file content
  }
}

// Turn ANY thrown value into a short, plain message. Never leaks file content.
export function friendlyMessage(err) {
  if (err instanceof ConvertError) return err.userMessage;
  if (err && err.name === 'AbortError') return 'Cancelled.';
  return 'Something went wrong while converting this file. Nothing was uploaded. Try again, or try a smaller file.';
}
