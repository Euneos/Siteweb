/** Shared theme colors for internal agenda/watch. Education blue requested by Pauline. */
const topicClasses: Record<string, string> = {
  'santé mentale': 'mental',
  CPS: 'cps',
  numérique: 'digital',
  éducation: 'education',
  jeunes: 'young',
  'relations sociales': 'relations',
  émotions: 'emotions',
}
export function topicClass(topic: string) {
  return topicClasses[topic] ? `euneos-topic euneos-topic--${topicClasses[topic]}` : ''
}
