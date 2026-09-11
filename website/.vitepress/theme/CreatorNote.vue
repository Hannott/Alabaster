<template>
  <div class="creator-note">
    <div class="creator-note-content">
      <h2>Creator's note</h2>
      <p>
        Thank you for trying Alabaster! I created this project both as an opportunity to learn
        frontend development through use of AI, and to build the features I wanted in a way that
        suited my needs and workflow. I have focused heavily on customization and usability, and I
        hope you find it as easy to use as I have. AI has helped me significantly throughout
        development, particularly with the documentation. Some sections may therefore be imperfect
        or overly conversational, and I appreciate your patience and understanding while I go
        through them manually later in the project development. If you encounter any issues or would
        like to suggest a feature, please open an issue on GitHub. Your feedback is very welcome.
      </p>
    </div>
  </div>
</template>

<style scoped>
.creator-note {
  margin: auto;
  width: 100%;
  max-width: 1152px;
  padding: 0 24px;
}

@media (min-width: 640px) {
  .creator-note {
    padding: 0 48px;
  }
}

@media (min-width: 960px) {
  .creator-note {
    padding: 0 64px;
  }
}

.creator-note-content {
  max-width: 640px;
  margin: 0 auto;
  padding: 16px 0 48px;
  text-align: justify;
}

.creator-note-content h2 {
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  color: var(--vp-c-text-1);
  margin-bottom: 12px;
}

.creator-note-content p {
  font-size: 14px;
  line-height: 24px;
  color: var(--vp-c-text-2);
}
</style>
