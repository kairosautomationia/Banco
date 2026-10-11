// Sondeo de LlamaParse con espera progresiva. El plan Workers Free permite 50 subpeticiones por solicitud:
// con un intervalo fijo de 2 s, un OCR lento (150 s) hacía 78 y fallaba con «Too many subrequests».
export const MAX_WAIT_MS = 150000;
export const pollDelay = (attempt) => Math.min(2000 + 500 * attempt, 6000);
