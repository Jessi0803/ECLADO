import React from 'react';
import CourseImage from './CourseImage.jsx';
import RichTextContent from '../rich-text/RichTextContent.jsx';

export default function CourseDescription({ value }) {
  return <RichTextContent value={value} imageComponent={CourseImage}
    plainTextClassName="course-store-description" />;
}
