// The bundled data: small workout ideas from running guides, each with the name of the publication it came from.
import ideasJson from '../data/workout_ideas/running.json' with { type: 'json' };

export const workoutIdeas = () => ideasJson.ideas ?? [];
