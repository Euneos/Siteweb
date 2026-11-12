import { test, expect } from 'bun:test'
import { publicSchoolLocation } from '../src/lib/public-school-location'
import confirmed from '../src/data/public-school-communes.json'
test('verified public schools resolve to the confirmed commune, including homonyms and renamed communes', () => {
  for (const entry of confirmed) {
    const result = publicSchoolLocation({name:entry.school,city:entry.city,location:null})
    expect(result.location).toMatchObject({code:entry.commune})
  }
})
test('unknown schools in a homonymous city remain unresolved and existing locations stay intact', () => {
  const unknown={name:'Autre école',city:'Sainte-Anne',location:null}
  expect(publicSchoolLocation(unknown)).toBe(unknown)
  const located={name:'Lycée Yves Leborgne',city:'Sainte-Anne',location:{code:'confirmed-in-source'}}
  expect(publicSchoolLocation(located)).toBe(located)
})
