const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

// Exponential with "equal jitter": many nodes restarting at once spread out.
function reconnectDelay(attempt, random = Math.random) {
    const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
    return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

module.exports = {
    MAX_DELAY_MS,
    reconnectDelay
};
