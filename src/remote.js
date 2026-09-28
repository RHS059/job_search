export function isRemote({ title = '', location = '', description = '', workplaceType = '' }) {
  if (/^(remote|telecommute)$/i.test(workplaceType)) return true;
  const text = `${title}. ${location}. ${description}`.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  return text.split(/[.!?;]/).some(sentence => {
    if (/\b(no|not|non)[ -]?remote\b|remote\s+(?:work\s+)?(?:is\s+)?(?:not|unavailable)|not\s+(?:a\s+)?remote/i.test(sentence)) return false;
    return /\bremote\b/i.test(sentence) && !/remote (?:teams|colleagues|customers|systems|access|offices)/i.test(sentence) || /\b(?:work|working|based|located)\s+(?:fully\s+)?remotely\b|\bwork(?:ing)? from home\b/i.test(sentence);
  });
}
