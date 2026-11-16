import React from 'react';
import RichTextEditor from './RichTextEditor.jsx';
import { downloadCourseImage, uploadCourseImage } from '../../services/courses.js';

export default function CourseDescriptionEditor(props) {
  return <RichTextEditor {...props} label="課程介紹"
    uploadImage={uploadCourseImage} downloadImage={downloadCourseImage} />;
}
