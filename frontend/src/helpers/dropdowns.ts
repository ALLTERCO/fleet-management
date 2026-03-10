export const DAY_OF_MONTH_OPTIONS = new Array(28)
    .fill(' of the month')
    .map((elem, i) => `0${i + 1}`.slice(-2) + elem);
