// To replace: convert your photo to base64 and update this value
// Option 1: https://www.base64-image.de
// Option 2: base64 -i photo.jpg (then prefix with data:image/jpeg;base64,)
// Option 3: node -e "console.log('data:image/jpeg;base64,' + require('fs').readFileSync('photo.jpg').toString('base64'))"

const PROFILE_IMAGE_B64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMTIwIiB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCI+PHJlY3Qgd2lkdGg9IjEyMCIgaGVpZ2h0PSIxMjAiIGZpbGw9IiNlOGU0ZGYiLz48Y2lyY2xlIGN4PSI2MCIgY3k9IjQ1IiByPSIyMiIgZmlsbD0iI2I1YWQ5ZiIvPjxlbGxpcHNlIGN4PSI2MCIgY3k9IjEwMyIgcng9IjM2IiByeT0iMjgiIGZpbGw9IiNiNWFkOWYiLz48L3N2Zz4=';

export default PROFILE_IMAGE_B64;
